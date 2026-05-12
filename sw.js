const CACHE = 'tradedesk-05.12.26.6';
const NAV_URL = '/index.html';

// Safari WebKit rejects any cached response with redirected:true when the SW
// tries to serve it for a navigation. new Response() always has redirected:false.
function safeClone(r) {
  if (!r.redirected) return r.clone();
  return new Response(r.clone().body, { status: r.status, statusText: r.statusText, headers: r.headers });
}

self.addEventListener('install', e => {
  self.skipWaiting();
  // Pre-cache the HTML shell so first open after install is instant.
  // Must use safeClone — server may redirect (HTTPS, trailing slash, etc.)
  e.waitUntil(
    fetch(NAV_URL).then(r => {
      if (!r.ok) return;
      return caches.open(CACHE).then(c => c.put(NAV_URL, safeClone(r)));
    }).catch(() => {})
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Navigation — cache-first for instant paint, update in background
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(NAV_URL).then(cached => {
        const networkFetch = fetch(e.request).then(r => {
          if (!r.ok) return r;
          // Cache without redirect flag
          caches.open(CACHE).then(c => c.put(NAV_URL, safeClone(r)));
          // Compare APP_VERSION — notify open tabs if version changed
          if (cached) {
            Promise.all([r.clone().text(), cached.clone().text()]).then(([freshHtml, cachedHtml]) => {
              const freshV  = (freshHtml.match(/APP_VERSION='([^']+)'/)  || [])[1];
              const cachedV = (cachedHtml.match(/APP_VERSION='([^']+)'/) || [])[1];
              if (freshV && cachedV && freshV !== cachedV) {
                self.clients.matchAll({ includeUncontrolled: true }).then(clients =>
                  clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }))
                );
              }
            }).catch(() => {});
          }
          return r;
        }).catch(() => null);

        if (cached) {
          networkFetch.catch(() => {});
          return cached;
        }
        return networkFetch || fetch(e.request);
      })
    );
    return;
  }

  // Static assets — cache-first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, safeClone(r)));
        return r;
      });
      return cached || net;
    })
  );
});
