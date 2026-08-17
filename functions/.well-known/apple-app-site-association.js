// Universal Links (owner ask 2026-08-17): a contractor who already has the
// app installed taps a proposal/sign or client-hub link and it opens IN the
// app instead of bouncing to Safari first. iOS fetches this exact path over
// HTTPS (no redirects allowed) before it will honor com.apple.developer.
// associated-domains for a given domain, matching the App.entitlements
// applinks: entries (ios-beta.yml).
//
// The Team ID is read from a Cloudflare Pages environment variable, never
// hardcoded here (owner 2026-08-17: "don't want to paste it anywhere"). One-
// time setup: Cloudflare dashboard -> Pages -> this project -> Settings ->
// Environment variables -> add APPLE_TEAM_ID (Production AND Preview) with
// the same value already configured as the APPLE_TEAM_ID GitHub secret for
// ios-beta.yml. Until that's set, this answers 404 rather than a broken
// association: a missing/empty appID would make iOS silently reject the
// WHOLE file (every entry, not just this one), so it's safer to serve
// nothing than to serve wrong.
const BUNDLE_ID = 'app.tradedesk.beta';

export async function onRequestGet({ env }) {
  const teamId = (env && env.APPLE_TEAM_ID || '').trim();
  if (!teamId) {
    return new Response('APPLE_TEAM_ID not configured for this Pages project', { status: 404 });
  }
  const appID = `${teamId}.${BUNDLE_ID}`;
  const body = {
    applinks: {
      details: [
        {
          appIDs: [appID],
          components: [
            { '/': '/sign.html*', comment: 'Proposal signing' },
            { '/': '/client.html*', comment: 'Client hub' },
            { '/': '/contract-sign.html*', comment: 'Contract signing' },
          ],
        },
      ],
    },
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
