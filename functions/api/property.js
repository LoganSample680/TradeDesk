// Round-robins across comma-separated PROPERTY_TUNNEL_URL values.
// Single server: PROPERTY_TUNNEL_URL=https://abc.cfargotunnel.com
// Multiple:      PROPERTY_TUNNEL_URL=https://abc.cfargotunnel.com,https://def.cfargotunnel.com
let _rr = 0;

export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const addr = (searchParams.get('addr') || '').trim();

  if (!addr) {
    return new Response(JSON.stringify({ error: 'addr required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const urls = (context.env.PROPERTY_TUNNEL_URL || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  if (!urls.length) {
    return new Response(null, { status: 204 });
  }

  const tunnelUrl = urls[_rr % urls.length];
  _rr++;

  try {
    const upstream = await fetch(
      `${tunnelUrl}/property?addr=${encodeURIComponent(addr)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const body = await upstream.text();
    // A "not found" from the property backend is a normal miss (the address just
    // isn't in its data), not an app error. Passing the raw 404 through made the
    // browser log a red /api/property 404 on every lookup. Normalize it to a
    // 200 {found:false} so the console stays clean; the client marks the address
    // as looked-up and moves on.
    if (upstream.status === 404) {
      return new Response(JSON.stringify({ found: false }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'proxy error' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
