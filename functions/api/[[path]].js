// Reverse-proxy: /api/* → Supabase project URL
// The browser only resolves the Cloudflare domain; Supabase DNS is resolved
// server-side by Cloudflare, eliminating ISP DNS fragility.

const SUPABASE = 'https://mwtsmctajhrrybblgorf.supabase.co';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const supaPath = url.pathname.replace(/^\/api/, '') || '/';
  const target = SUPABASE + supaPath + url.search;

  // CORS preflight
  if (request.method === 'OPTIONS') {
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

  // WebSocket upgrade — Supabase Realtime
  if (request.headers.get('Upgrade') === 'websocket') {
    const wsTarget = target.replace(/^https/, 'wss');
    const upstreamRes = await fetch(wsTarget, { headers: fwdHeaders });
    const upstream = upstreamRes.webSocket;
    if (!upstream) {
      return new Response('WebSocket upstream unavailable', { status: 502 });
    }
    upstream.accept();

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    server.addEventListener('message', e => { try { upstream.send(e.data); } catch (_) {} });
    upstream.addEventListener('message', e => { try { server.send(e.data); } catch (_) {} });
    server.addEventListener('close', e => { try { upstream.close(e.code, e.reason); } catch (_) {} });
    upstream.addEventListener('close', e => { try { server.close(e.code, e.reason); } catch (_) {} });

    return new Response(null, { status: 101, webSocket: client });
  }

  // HTTP proxy
  const res = await fetch(target, {
    method: request.method,
    headers: fwdHeaders,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
    redirect: 'follow',
  });

  const resHeaders = new Headers(res.headers);
  resHeaders.set('Access-Control-Allow-Origin', request.headers.get('Origin') || '*');
  resHeaders.set('Access-Control-Allow-Credentials', 'true');

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
  });
}
