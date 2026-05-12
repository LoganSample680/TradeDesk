const CACHE = 'tradedesk-05.12.26.1'; // bump this with every deploy — forces browser to install new SW
const NAV_URL = '/index.html';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  // Clear any old cache versions, take control of all open tabs immediately
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
    // Note: SW_UPDATED is NOT sent here — only sent when version actually changes.
    // Sending it on every activate would reload the app on first-ever install.
  );
});

self.addEventListener('fetch', e => {
  // Navigation (loading the app HTML) — cache-first for instant paint, update in background
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match(NAV_URL).then(cached => {
        // Always fetch fresh from network in background
        const networkFetch = fetch(e.request).then(r => {
          if (!r.ok) return r;
          // Update cache with fresh response
          caches.open(CACHE).then(c => c.put(NAV_URL, r.clone()));
          // Compare APP_VERSION in fresh HTML vs. cached HTML — notify if changed
          if (cached) {
            Promise.all([r.clone().text(), cached.clone().text()]).then(([freshHtml, cachedHtml]) => {
              const freshV  = (freshHtml.match(/APP_VERSION='([^']+)'/)  || [])[1];
              const cachedV = (cachedHtml.match(/APP_VERSION='([^']+)'/) || [])[1];
              if (freshV && cachedV && freshV !== cachedV) {
                self.clients.matchAll({includeUncontrolled: true}).then(clients =>
                  clients.forEach(c => c.postMessage({type: 'SW_UPDATED'}))
                );
              }
            }).catch(() => {});
          }
          return r;
        }).catch(() => null);

        if (cached) {
          // Serve cache instantly — background fetch runs in parallel
          networkFetch.catch(() => {});
          return cached;
        }
        // No cache yet (first ever open) — wait for network
        return networkFetch || fetch(e.request);
      })
    );
    return;
  }

  // All other assets (JS, CSS, images) — cache-first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
        return r;
      });
      return cached || net;
    })
  );
});
