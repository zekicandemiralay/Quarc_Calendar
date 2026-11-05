// Service worker: lets the app shell load with no connection at all.
//
//  - Page navigations: network first (so updates show up immediately), falling
//    back to the cached app shell when offline.
//  - Static assets (hashed JS/CSS, images): cache first, refreshed in the background.
//  - /api/ requests are never touched here. Offline data lives in IndexedDB
//    (see src/lib/db.js), not in this cache.
const CACHE = 'quarc-calendar-v1';
const SHELL = ['/', '/manifest.json', '/logo.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || request.url.includes('/api/')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE).then((c) => c.put('/', response.clone()));
          return response;
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
