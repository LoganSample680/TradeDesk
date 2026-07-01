const CACHE = 'tradedesk-07.01.26.7';

// Safari WebKit rejects any cached response with redirected:true when the SW
// tries to serve it for a navigation. new Response() always has redirected:false.
function safeClone(r) {
  if (!r.redirected) return r.clone();
  return new Response(r.clone().body, { status: r.status, statusText: r.statusText, headers: r.headers });
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

  // Share target — POST from iOS share sheet with a photo file.
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

  // Navigation — network-first with cache:'no-cache' so CDN and browser HTTP
  // cache are both bypassed. Offline fallback to SW cache for iOS PWA support.
  if (e.request.mode === 'navigate') {
    const navPath = url.pathname;
    if (navPath !== '/' && navPath !== '/index.html' && navPath !== '') return;
    e.respondWith(
      fetch(new Request(e.request.url, {cache: 'no-cache'})).then(r => {
        if (!r.ok) return r;
        caches.open(CACHE).then(c => c.put('/index.html', safeClone(r)));
        return r;
      }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Only cache GET requests over http/https
  if (e.request.method !== 'GET' || (url.protocol !== 'http:' && url.protocol !== 'https:')) return;

  // Never cache version.json — must always reflect the live server value
  if (url.pathname === '/version.json') return;

  // Never cache .well-known — Apple Pay domain verification must always be fetched fresh
  if (url.pathname.startsWith('/.well-known/')) return;

  // Never intercept Supabase requests — REST and storage responses mutate (proposal
  // JSON is rewritten at signing). Cache-first here serves stale documents and can
  // pin failures. Let the network handle all of it.
  if (url.hostname.endsWith('supabase.co')) return;

  // Static assets (JS, CSS, images) — cache-first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) {
          const toCache = safeClone(r);
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return r;
      }).catch(() => new Response('', { status: 503, statusText: 'Network Unavailable' }));
      // .catch(() => new Response(503)) — if the SW's network fetch fails (offline,
      // external host unreachable, CI environment), resolve with a 503 instead of
      // leaving an unhandled rejection. Response.error() is NOT used here because
      // WebKit fires "Response served by service worker is an error" pageerror when
      // the SW returns Response.error(). A real 503 Response resolves cleanly — the
      // page's fetch() resolves (non-ok), r.json() throws SyntaxError on empty body,
      // and the caller's .catch(()=>null) handles it with zero pageerrors.
      return cached || net;
    })
  );
});
