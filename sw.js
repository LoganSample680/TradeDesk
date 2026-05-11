const CACHE = 'tradedesk-v1';
const SW_VERSION = '05.10.26.59'; // auto-bumped by push.sh — changing this forces a new SW install

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll({includeUncontrolled: true}))
      .then(clients => clients.forEach(c => c.postMessage({type: 'SW_UPDATED'})))
  );
});

self.addEventListener('fetch', e => {
  // Navigate requests AND explicit cache:'reload' fetches (version checks) always go
  // straight to the network — SW cache is bypassed and then updated with fresh content.
  if (e.request.mode === 'navigate' || e.request.cache === 'reload') {
    e.respondWith(
      fetch(e.request, {cache: 'reload'})
        .then(r => {
          if (r.ok) caches.open(CACHE).then(c => c.put(e.request, r.clone()));
          return r;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Cache-first for all other static assets (JS, CSS, images)
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
