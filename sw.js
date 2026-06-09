// Noted – Service Worker v3
// Bump CACHE version any time you deploy changes — forces old SW to be replaced

const CACHE = 'noted-v3';
const BASE  = '/noted';
const ASSETS = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/styles.css',
  BASE + '/app.js',
  BASE + '/manifest.json',
  BASE + '/icon-192.png',
  BASE + '/icon-512.png',
];

// ── Install: cache assets individually so one failure doesn't break everything
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.allSettled(ASSETS.map(url =>
        cache.add(url).catch(err => console.warn('SW: failed to cache', url, err))
      ))
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: remove ALL old caches, take control immediately
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for our assets, network-first for everything else
self.addEventListener('fetch', e => {
  // Only handle GET requests for our own origin
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;

      return fetch(e.request).then(res => {
        // Only cache successful responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline fallback: return the cached app shell
        return caches.match(BASE + '/index.html');
      });
    })
  );
});

// ── Push notification
self.addEventListener('push', e => {
  const data = e.data
    ? e.data.json()
    : { title: 'Noted', body: "Don't forget to check today's list!" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: BASE + '/icon-192.png',
      badge: BASE + '/icon-192.png',
      tag: 'noted-daily',
      renotify: true,
      data: { url: BASE + '/' }
    })
  );
});

// ── Notification click: open / focus the app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appClient = list.find(c => c.url.includes(BASE));
      if (appClient) return appClient.focus();
      return clients.openWindow(BASE + '/');
    })
  );
});

// ── Message from app: show a local reminder notification
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_REMINDER') {
    self.registration.showNotification('🌙 Noted — Good morning!', {
      body: e.data.body || 'You have items on your list today.',
      icon: BASE + '/icon-192.png',
      badge: BASE + '/icon-192.png',
      tag: 'noted-daily',
      renotify: true
    });
  }
});
