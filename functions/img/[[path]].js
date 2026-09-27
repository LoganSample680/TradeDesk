// Edge-cached image route: /img/gallery/<object-path> → Supabase public storage.
//
// Egress fix: job photos and logos are immutable public objects (every path
// carries a timestamp or content hash), but they used to be served straight
// from Supabase storage on every view, every hub open by every client billed
// the full bytes against the Supabase egress cap. This route serves them from
// Cloudflare's edge cache instead: Supabase pays for ONE fetch per object per
// PoP; every repeat view is Cloudflare cache (free, faster).
//
// Scope is deliberately narrow: GET/HEAD on the public `gallery` bucket only.
// Nothing private is reachable here, the bucket is already public via
// getPublicUrl; this just changes which CDN fronts it. The app falls back to
// the direct Supabase URL on any error (see _imgFallback in js/proposals.js /
// client.html), so this route can never make an image unreachable.

const SUPABASE = 'https://mwtsmctajhrrybblgorf.supabase.co';

// This route answers on the APP'S OWN ORIGIN, so whatever it serves runs with
// the app's cookies and storage if a browser renders it as a page. The gallery
// bucket takes uploads, so a file uploaded as text/html (or anything else a
// browser will execute) would have been same-origin script on tradedeskpro.app,
// cached "immutable" for a year. Three rules close that:
//   1. Only image/* is ever served. Anything else is a 415 and never cached.
//   2. Every response says nosniff, so a browser cannot decide an image is HTML.
//   3. A locked-down CSP with sandbox, so even an SVG opened directly cannot
//      run script or reach the app.
const IMG_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
  'Content-Disposition': 'inline',
};
// Bumped with the rules above so an entry cached under the old pass-through
// (possibly not an image) can never be served again: it is simply not found.
const CACHE_VERSION = 'v2';
function isImageType(ct) {
  return /^image\/[\w.+-]+$/i.test(String(ct || '').split(';')[0].trim());
}

export async function onRequest(context) {
  const { request, waitUntil } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  const objectPath = url.pathname.replace(/^\/img\//, '');
  if (!/^gallery\/[\w\-./%]+$/.test(objectPath) || objectPath.includes('..')) {
    // FALL THROUGH, do not 404. This route is mounted at /img/[[path]], so it
    // intercepts EVERY path under /img/, including plain static files that have
    // nothing to do with Supabase. Returning 404 here made the promise in the
    // header above ("this route can never make an image unreachable") false:
    // three static PNGs added under /img/ on 2026-09-21 shipped to UAT and drew
    // as broken-image glyphs in Tim's dock and sheet, and no offline test could
    // see it, because the local static server has no Pages Functions in front
    // of it.
    // context.next() hands the request back to the static asset handler, so an
    // unmatched path gets the real file when one exists and Pages' own 404 when
    // it does not. Supabase is still only ever touched for a gallery/ path, and
    // a traversal attempt still never reaches upstream.
    return context.next();
  }

  // Edge cache first, a hit costs Supabase nothing.
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname + '?cv=' + CACHE_VERSION, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached && isImageType(cached.headers.get('Content-Type'))) return cached;

  const upstream = await fetch(SUPABASE + '/storage/v1/object/public/' + objectPath, {
    cf: { cacheTtl: 2592000, cacheEverything: true },
  });
  if (!upstream.ok) return new Response('Not found', { status: upstream.status, headers: { 'X-Content-Type-Options': 'nosniff' } });
  const upstreamType = upstream.headers.get('Content-Type') || '';
  if (!isImageType(upstreamType)) {
    return new Response('Unsupported media type', {
      status: 415,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
    });
  }

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      ...IMG_SECURITY_HEADERS,
      'Content-Type': upstreamType,
      // Objects are immutable (timestamp/hash paths), cache aggressively
      // everywhere: browser, Cloudflare edge, any intermediary.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
  if (typeof waitUntil === 'function') waitUntil(cache.put(cacheKey, res.clone()));
  else await cache.put(cacheKey, res.clone());
  return res;
}
