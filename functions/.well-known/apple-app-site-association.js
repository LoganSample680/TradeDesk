// Universal Links (owner ask 2026-08-17): a contractor who already has the
// app installed taps a proposal/sign or client-hub link and it opens IN the
// app instead of bouncing to Safari first. iOS fetches this exact path over
// HTTPS (no redirects allowed) before it will honor com.apple.developer.
// associated-domains for a given domain, matching the App.entitlements
// applinks: entries (ios-beta.yml).
//
// PLACEHOLDER: fill in the real Team ID below (developer.apple.com -> Account
// -> Membership, the same value already configured as the APPLE_TEAM_ID
// GitHub secret for ios-beta.yml) before this does anything. A wrong or
// missing Team ID means iOS silently ignores the whole file, links just open
// in Safari as they do today: nothing breaks, the capability just stays off.
const APPLE_TEAM_ID = 'REPLACE_WITH_TEAM_ID';
const BUNDLE_ID = 'app.tradedesk.beta';

export async function onRequestGet() {
  const appID = `${APPLE_TEAM_ID}.${BUNDLE_ID}`;
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
