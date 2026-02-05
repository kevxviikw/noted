// static/sw.js
const CACHE_NAME = "didit-cache-v1";
const ASSETS = [
  "/",                  // index via backend’s "/" route
  "/static/index.html", // fallback
  "/static/manifest.webmanifest",
  "/static/icons/ICON.jpg",
//  "/static/icons/icon-512.png"
  // add css/js files if you split them out later
];

// Install – cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate – cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch – network-first for API, cache-first for static
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Don’t try to cache POST/PUT/DELETE, only GET
  if (event.request.method !== "GET") return;

  // API: network-first
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static/UI: cache-first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return (
        cached ||
        fetch(event.request).then((resp) => {
          // Optionally update cache
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
          return resp;
        }).catch(() => {
          // Fallback to cached index if offline
          if (event.request.mode === "navigate") {
            return caches.match("/static/index.html");
          }
        })
      );
    })
  );
});