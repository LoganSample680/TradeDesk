// GET /  : the one URL both the marketing site and the app want.
//
// tradedeskpro.app/ is the app for everyone who already uses it (the iPhone
// shell, a home-screen install, any browser that has booted the app) and the
// marketing page for everyone else (a first visit, a crawler, a shared link).
// Both live in this one Pages project, so this function decides which of the
// two static files answers "/" and serves it from the asset layer.
//
//   app      when the request carries the td_app cookie (js/cloud.js sets it on
//            every session-backed boot and clears it when the account is wiped),
//            or the native shell's user agent (native/capacitor.config.json
//            appendUserAgent), or ANY query string: ?app=1 and ?signup=1 are the
//            landing page's own links, and every deep link the app already
//            honors (?emp_invite=, ?sub_invite=, OAuth ?code=, ?stripe_connected=,
//            ?shortcut=) must keep landing in the app.
//   landing  otherwise. landing.html is the marketing home; its canonical tag
//            names "/", so /landing is never a duplicate in search.
//
// Only "/" goes through here (functions/ routing is by file path), so every
// other page and asset is still served straight from the CDN with no function
// invocation. The response is marked X-TD-Page so sw.js never caches the
// marketing page as the app's offline fallback.
const APP_COOKIE = /(?:^|;\s*)td_app=1(?:;|$)/;
const SHELL_UA = /TradeDeskShell/i;

export function wantsApp(request) {
  const url = new URL(request.url);
  if (url.search && url.search !== '?') return true;
  if (APP_COOKIE.test(request.headers.get('cookie') || '')) return true;
  if (SHELL_UA.test(request.headers.get('user-agent') || '')) return true;
  return false;
}

export async function onRequest(context) {
  const { request, env, next } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') return next();
  const app = wantsApp(request);
  // "/" in the asset layer is index.html (the app); "/landing" is landing.html.
  // env.ASSETS is the static layer only, so this never re-enters the function.
  const asset = new URL(app ? '/' : '/landing', request.url);
  const res = await env.ASSETS.fetch(new Request(asset.toString(), { method: request.method, headers: request.headers }));
  const headers = new Headers(res.headers);
  // _headers only covers static responses; the app relies on no-store for its
  // version watchdog, and the landing/app choice depends on the cookie.
  headers.set('Cache-Control', 'no-store, must-revalidate');
  headers.set('Vary', 'Cookie, User-Agent');
  headers.set('X-TD-Page', app ? 'app' : 'landing');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
