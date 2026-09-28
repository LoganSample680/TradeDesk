const CACHE = 'tradedesk-09.28.26.15';

// Safari WebKit rejects any cached response with redirected:true when the SW
// tries to serve it for a navigation. new Response() always has redirected:false.
function safeClone(r) {
  if (!r.redirected) return r.clone();
  return new Response(r.clone().body, { status: r.status, statusText: r.statusText, headers: r.headers });
}

// The allowlist. Same origin only, and only the files the app is built from.
// /img/ and /api/ are named as never, even though neither matches a rule,
// so a later edit to the allowlist cannot quietly let them in.
const SHELL_PREFIXES = ['/js/', '/css/', '/icons/', '/fonts/', '/_ds/'];
const SHELL_FILE = /^\/(manifest[\w.-]*\.json|favicon\.ico|sw-colors\.json)$/;
const SHELL_FONT = /\.(woff2?|ttf|otf)$/i;
function _isAppShell(url) {
  if (url.origin !== self.location.origin) return false;
  const p = url.pathname;
  if (p.startsWith('/img/') || p.startsWith('/api/') || p === '/img' || p === '/api') return false;
  if (SHELL_PREFIXES.some(pre => p.startsWith(pre))) return true;
  if (SHELL_FILE.test(p)) return true;
  if (SHELL_FONT.test(p)) return true;
  return false;
}

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      const old = keys.filter(k => k !== CACHE);
      const isUpdate = old.length > 0;
      return Promise.all(old.map(k => caches.delete(k)))
        .then(() => self.clients.claim())
        .then(() => {
          if (!isUpdate) return;
          return self.clients.matchAll({ includeUncontrolled: true }).then(clients =>
            clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
          );
        });
    })
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Share target, POST from iOS share sheet with a photo file.
  // Cache the formData so the app can retrieve it after navigation.
  if (e.request.method === 'POST' && url.searchParams.get('shortcut') === 'share-photo') {
    e.respondWith(
      e.request.formData().then(fd => {
        return caches.open('share-target-v1').then(c => {
          return c.put('/share-target-latest', new Response(fd));
        });
      }).then(() => Response.redirect('/?shortcut=share-photo', 303))
    );
    return;
  }

  // Navigation, network-first with cache:'no-cache' so CDN and browser HTTP
  // cache are both bypassed. Offline fallback to SW cache for iOS PWA support.
  if (e.request.mode === 'navigate') {
    const navPath = url.pathname;
    if (navPath !== '/' && navPath !== '/index.html' && navPath !== '') return;
    e.respondWith(
      fetch(new Request(e.request.url, {cache: 'no-cache'})).then(r => {
        if (!r.ok) return r;
        // The marketing page comes back from / for a signed-out browser (functions/index.js
        // marks it). It must never become the offline fallback for the app.
        if (r.headers.get('x-td-page') === 'landing') return r;
        // Clone SYNCHRONOUSLY, before `return r` hands the response to the browser
        // and its body is consumed. safeClone inside the async caches.open().then()
        // ran too late: the body was already used, throwing "Response body is already
        // used" on every navigation (matches the working static-asset path below).
        const toCache = safeClone(r);
        caches.open(CACHE).then(c => c.put('/index.html', toCache));
        return r;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Only cache GET requests over http/https
  if (e.request.method !== 'GET' || (url.protocol !== 'http:' && url.protocol !== 'https:')) return;

  // Never cache version.json, must always reflect the live server value
  if (url.pathname === '/version.json') return;

  // Never cache .well-known, Apple Pay domain verification must always be fetched fresh
  if (url.pathname.startsWith('/.well-known/')) return;

  // Never intercept Supabase requests, REST and storage responses mutate (proposal
  // JSON is rewritten at signing). Cache-first here serves stale documents and can
  // pin failures. Let the network handle all of it.
  if (url.hostname.endsWith('supabase.co')) return;

  // The SAME Supabase traffic arrives SAME-ORIGIN when the app runs behind the
  // /api reverse proxy (the self-healing fallback for carriers that cannot
  // resolve supabase.co, and every flow-test environment). The hostname check
  // above cannot see it, so /api REST GETs were falling into the cache-first
  // branch below: the first response for a URL got pinned, and every repeat
  // was answered from that stale copy instead of the live database. Observed
  // live: a signature-status query kept returning an empty result cached from
  // before the row existed, so a declined proposal could stay counted as
  // "awaiting signature" no matter how many times the app re-checked.
  if (url.pathname.startsWith('/api/')) return;

  // ONLY the app's own static shell is ever cached (2026-09-27 lockdown).
  // This used to cache every successful GET that reached it, which put three
  // kinds of thing on the phone's disk that do not belong there: other sites'
  // responses (CDN scripts, fonts, map tiles), anything under /img/ (customer
  // job photos served by the edge proxy, left behind after sign-out on a
  // shared crew phone), and any same-origin path a future route might answer
  // with account data. A request that is not the app shell goes straight to
  // the network, untouched.
  if (!_isAppShell(url)) return;

  // Static app shell (JS, CSS, icons, manifest, fonts), cache-first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) {
          const toCache = safeClone(r);
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return r;
      }).catch(() => new Response('', { status: 503, statusText: 'Network Unavailable' }));
      // .catch(() => new Response(503)), if the SW's network fetch fails (offline,
      // external host unreachable, CI environment), resolve with a 503 instead of
      // leaving an unhandled rejection. Response.error() is NOT used here because
      // WebKit fires "Response served by service worker is an error" pageerror when
      // the SW returns Response.error(). A real 503 Response resolves cleanly, the
      // page's fetch() resolves (non-ok), r.json() throws SyntaxError on empty body,
      // and the caller's .catch(()=>null) handles it with zero pageerrors.
      return cached || net;
    })
  );
});
