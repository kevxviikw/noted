// Noted — Service Worker v4
// Bump CACHE any time you deploy — forces old SW to be replaced immediately

const CACHE = 'noted-v4';
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

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(err =>
          console.warn('SW: failed to cache', url, err)
        ))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clear old caches ─────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for our assets, network otherwise ──────────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(BASE + '/index.html'));
    })
  );
});

// ── Notification click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  const { action, notification } = e;
  const { itemId, dateKey } = notification.data || {};

  e.notification.close(); // dismiss it from lock screen / notification centre

  if (action === 'complete' && itemId && dateKey) {
    // Tell the app to mark this item done
    e.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
        // Post to every open window (app may be backgrounded)
        list.forEach(client => client.postMessage({
          type: 'COMPLETE_ITEM',
          itemId,
          dateKey,
        }));
        // If no window is open, open a new one — the app reads a pending queue on boot
        if (list.length === 0) {
          // Store pending completion in cache so app picks it up next launch
          return storePendingCompletion(itemId, dateKey)
            .then(() => clients.openWindow(BASE + '/'));
        }
      })
    );
    return;
  }

  if (action === 'dismiss') {
    // Notification already closed above — nothing else to do
    return;
  }

  // Default: tapping the notification body opens / focuses the app
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const appClient = list.find(c => c.url.includes(BASE));
      if (appClient) return appClient.focus();
      return clients.openWindow(BASE + '/');
    })
  );
});

// ── Pending completions (for when app was closed when Done was tapped) ─────
async function storePendingCompletion(itemId, dateKey) {
  const cache = await caches.open(CACHE);
  let pending = [];
  try {
    const res = await cache.match('__pending_completions__');
    if (res) pending = await res.json();
  } catch {}
  pending.push({ itemId, dateKey });
  await cache.put('__pending_completions__',
    new Response(JSON.stringify(pending), { headers: { 'Content-Type': 'application/json' } })
  );
}

// ── Message from app ────────────────────────────────────────────────────────
self.addEventListener('message', e => {
  if (!e.data) return;

  // App asking for any pending completions it missed while closed
  if (e.data.type === 'GET_PENDING_COMPLETIONS') {
    caches.open(CACHE).then(async cache => {
      try {
        const res = await cache.match('__pending_completions__');
        const pending = res ? await res.json() : [];
        if (pending.length > 0) {
          e.source.postMessage({ type: 'PENDING_COMPLETIONS', items: pending });
          // Clear the queue
          await cache.delete('__pending_completions__');
        }
      } catch {}
    });
    return;
  }

  // App asking SW to show a local notification (morning reminder trigger)
  if (e.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag, itemId, dateKey } = e.data;
    self.registration.showNotification(title, {
      body,
      tag,
      icon: BASE + '/icon-192.png',
      badge: BASE + '/icon-192.png',
      renotify: true,
      actions: itemId
        ? [{ action: 'complete', title: '✓ Done' }, { action: 'dismiss', title: 'Dismiss' }]
        : [{ action: 'dismiss', title: 'Dismiss' }],
      data: { itemId: itemId || null, dateKey: dateKey || null, url: BASE + '/' },
    });
  }
});
