export async function onRequest(context) {
  const { searchParams } = new URL(context.request.url);
  const addr = (searchParams.get('addr') || '').trim();

  if (!addr) {
    return new Response(JSON.stringify({ error: 'addr required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const tunnelUrl = context.env.PROPERTY_TUNNEL_URL;
  if (!tunnelUrl) {
    // Return empty 204 rather than 503 so the UI silently skips the card
    return new Response(null, { status: 204 });
  }

  try {
    const upstream = await fetch(
      `${tunnelUrl}/property?addr=${encodeURIComponent(addr)}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const body = await upstream.text();
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
