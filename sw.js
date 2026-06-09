// Noted – Service Worker
// Handles offline caching and scheduled morning notifications

const CACHE = 'noted-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.json'];

// ── Install: cache all assets ──────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, fall back to network ──────────────────────────
self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return res;
    }))
  );
});

// ── Push: show notification from server (or self.registration.showNotification) ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : { title: 'Noted', body: "Don't forget to check today's list!" };
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'noted-daily',
      renotify: true,
      data: { url: '/' }
    })
  );
});

// ── Notification click: open/focus the app ─────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow('/');
    })
  );
});

// ── Message: schedule a local morning reminder ─────────────────────────────
// The app posts { type: 'SCHEDULE_REMINDER', hour, minute, summary } messages
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SHOW_REMINDER') {
    self.registration.showNotification('🌙 Noted — Good morning!', {
      body: e.data.body || "You have items on your list today.",
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'noted-daily',
      renotify: true
    });
  }
});
