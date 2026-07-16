// Reverse-proxy: /api/* → Supabase project URL
// The browser only resolves the Cloudflare domain; Supabase DNS is resolved
// server-side by Cloudflare, eliminating ISP DNS fragility.
//
// USAGE ATTRIBUTION: every /api hit is one Cloudflare Pages-Functions invocation
// (the metered cost). We write ONE Workers Analytics Engine data-point per request
//, timestamp + path + method + status + latency + ray-id + country, so you can
// later answer "what EXACTLY caused the usage spike at 14:09:22 UTC, to the second."
// The write is fire-and-forget and GATED on the binding existing (env.API_ANALYTICS),
// so the proxy behaves identically whether or not the dataset is configured.
// See docs/CLOUDFLARE-USAGE-ATTRIBUTION.md for the binding + how to query it.

const SUPABASE = 'https://mwtsmctajhrrybblgorf.supabase.co';

// Bucket a Supabase path down to a stable, low-cardinality endpoint label so the
// analytics index groups cleanly (e.g. /rest/v1/td_bids?id=eq.123 → /rest/v1/td_bids).
function endpointLabel(p) {
  const base = (p.split('?')[0] || '/');
  // storage object keys are highly unique, collapse to the bucket level.
  const m = base.match(/^\/storage\/v1\/object\/([^/]+\/[^/]+)/);
  if (m) return '/storage/v1/object/' + m[1];
  return base;
}

// Fire-and-forget analytics write. Never throws into the request path.
function recordUsage(env, request, { endpoint, method, status, ms, kind }) {
  try {
    if (!env || !env.API_ANALYTICS || typeof env.API_ANALYTICS.writeDataPoint !== 'function') return;
    const cf = request.cf || {};
    env.API_ANALYTICS.writeDataPoint({
      // blobs: string dimensions (queryable as blob1..blobN)
      blobs: [
        endpoint,                                   // blob1, the endpoint hit
        method,                                     // blob2, GET/POST/...
        kind,                                       // blob3, 'http' | 'ws'
        request.headers.get('cf-ray') || '',        // blob4, Cloudflare ray id (exact request)
        cf.country || '',                           // blob5, client country
        cf.colo || '',                              // blob6, edge PoP that served it
      ],
      // doubles: numeric metrics (queryable as double1..double2)
      doubles: [status, ms],                        // double1, HTTP status, double2, upstream latency ms
      // index: the sampling/group key (≤32 bytes), endpoint so you GROUP BY it fast
      indexes: [endpoint.slice(0, 32)],
    });
  } catch (_) { /* analytics must never break the proxy */ }
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const supaPath = url.pathname.replace(/^\/api/, '') || '/';
  const target = SUPABASE + supaPath + url.search;
  const endpoint = endpointLabel(supaPath);
  const t0 = Date.now();

  // CORS preflight, cheap, but still an invocation, so record it.
  if (request.method === 'OPTIONS') {
    recordUsage(env, request, { endpoint, method: 'OPTIONS', status: 204, ms: 0, kind: 'http' });
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const fwdHeaders = new Headers(request.headers);
  fwdHeaders.delete('host');

  // WebSocket upgrade, Supabase Realtime.
  // Workers can't fetch() a wss:// URL, a WebSocket is opened by fetching the
  // https URL with the Upgrade header intact. The old wss:// rewrite made every
  // realtime connection fail, killing cross-device live sync.
  if (request.headers.get('Upgrade') === 'websocket') {
    const upstreamRes = await fetch(target, { headers: fwdHeaders });
    const upstream = upstreamRes.webSocket;
    if (!upstream) {
      recordUsage(env, request, { endpoint, method: 'WS', status: 502, ms: Date.now() - t0, kind: 'ws' });
      return new Response('WebSocket upstream unavailable', { status: 502 });
    }
    upstream.accept();

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    server.addEventListener('message', e => { try { upstream.send(e.data); } catch (_) {} });
    upstream.addEventListener('message', e => { try { server.send(e.data); } catch (_) {} });
    server.addEventListener('close', e => { try { upstream.close(e.code, e.reason); } catch (_) {} });
    upstream.addEventListener('close', e => { try { server.close(e.code, e.reason); } catch (_) {} });

    recordUsage(env, request, { endpoint, method: 'WS', status: 101, ms: Date.now() - t0, kind: 'ws' });
    return new Response(null, { status: 101, webSocket: client });
  }

  // HTTP proxy
  const res = await fetch(target, {
    method: request.method,
    headers: fwdHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    redirect: 'follow',
  });

  recordUsage(env, request, { endpoint, method: request.method, status: res.status, ms: Date.now() - t0, kind: 'http' });

  const resHeaders = new Headers(res.headers);
  resHeaders.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
  resHeaders.set('Access-Control-Allow-Credentials', 'true');

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
}
