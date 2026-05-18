const CACHE = 'tradedesk-05.18.26.88';

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

self.addEventListener('push', e => {
  let d={};
  try{d=e.data?e.data.json():{};}catch(err){}
  const title=d.title||'TradeDesk';
  const body=d.body||'You have a new notification';
  e.waitUntil(
    self.registration.showNotification(title,{
      body,icon:'/icon-192.png',badge:'/icon-96.png',
      data:d.url?{url:d.url}:{},
      vibrate:[200,100,200],requireInteraction:false
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url=e.notification.data?.url||'/';
  e.waitUntil(
    clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
      for(const c of list){
        if(c.url.includes(self.registration.scope)&&'focus' in c){
          c.postMessage({type:'NOTIFICATION_CLICK',url});
          return c.focus();
        }
      }
      if(clients.openWindow)return clients.openWindow(url);
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

  // Don't cache client-hub snapshots — they change every time a new proposal is sent.
  if (url.hostname.endsWith('supabase.co') && url.pathname.includes('/client-hub/')) return;

  // Static assets (JS, CSS, images) — cache-first, update in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(r => {
        if (r.ok) {
          const toCache = safeClone(r);
          caches.open(CACHE).then(c => c.put(e.request, toCache));
        }
        return r;
      });
      return cached || net;
    })
  );
});
