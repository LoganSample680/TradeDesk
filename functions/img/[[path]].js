// Edge-cached image route: /img/gallery/<object-path> → Supabase public storage.
//
// Egress fix: job photos and logos are immutable public objects (every path
// carries a timestamp or content hash), but they used to be served straight
// from Supabase storage on every view — every hub open by every client billed
// the full bytes against the Supabase egress cap. This route serves them from
// Cloudflare's edge cache instead: Supabase pays for ONE fetch per object per
// PoP; every repeat view is Cloudflare cache (free, faster).
//
// Scope is deliberately narrow: GET/HEAD on the public `gallery` bucket only.
// Nothing private is reachable here — the bucket is already public via
// getPublicUrl; this just changes which CDN fronts it. The app falls back to
// the direct Supabase URL on any error (see _imgFallback in js/proposals.js /
// client.html), so this route can never make an image unreachable.

const SUPABASE = 'https://mwtsmctajhrrybblgorf.supabase.co';

export async function onRequest(context) {
  const { request, waitUntil } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  const objectPath = url.pathname.replace(/^\/img\//, '');
  if (!/^gallery\/[\w\-./%]+$/.test(objectPath) || objectPath.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  // Edge cache first — a hit costs Supabase nothing.
  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(SUPABASE + '/storage/v1/object/public/' + objectPath, {
    cf: { cacheTtl: 2592000, cacheEverything: true },
  });
  if (!upstream.ok) return new Response('Not found', { status: upstream.status });

  const res = new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      // Objects are immutable (timestamp/hash paths) — cache aggressively
      // everywhere: browser, Cloudflare edge, any intermediary.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  });
  if (typeof waitUntil === 'function') waitUntil(cache.put(cacheKey, res.clone()));
  else await cache.put(cacheKey, res.clone());
  return res;
}
