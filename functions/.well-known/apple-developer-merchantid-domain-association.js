// Apple Pay domain verification for the client hub (owner ask 2026-08-17).
//
// Apple's crawler fetches this exact path over HTTPS before Apple Pay is
// allowed to appear on the domain, and the Payment Element only shows the
// Apple Pay button once Stripe has registered the domain AND this file
// answers. It must be served FROM the domain itself; a redirect to another
// host fails Apple's validation.
//
// Proxied from Stripe rather than vendored into the repo, for the same reason
// the /api proxy exists: the origin owns the content. Stripe's copy is the
// canonical one for every merchant using Stripe, and if they ever rotate it,
// this stays correct with zero deploys. Edge-cached for a day so Apple's
// crawler and repeat checks cost one upstream fetch, not one per hit.
export async function onRequestGet() {
  const upstream = 'https://stripe.com/files/apple-pay/apple-developer-merchantid-domain-association';
  const res = await fetch(upstream, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!res.ok) {
    return new Response('domain association unavailable', { status: 502 });
  }
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
