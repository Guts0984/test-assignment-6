/* Offline support: lets the calendar page load while the network is down, so the queued changes
 * (kept in IndexedDB) can be shown again and sent later. API calls are never cached: the app itself
 * handles their failure (it queues the change). */
const STATIC = 'static-v1';
const PAGES = 'pages-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The page asks us to forget everything on sign-out: the cached HTML belongs to one user.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear') {
    event.waitUntil(Promise.all([caches.delete(PAGES), caches.delete(STATIC)]));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // never touch the API

  // Hashed build files never change: cache first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Page loads: network first; remember the last good HTML; fall back to it when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const response = await fetch(request);
          if (response.ok && url.pathname.startsWith('/calendar')) {
            cache.put(request.url, response.clone());
            cache.put('/calendar', response.clone()); // a generic fallback for any calendar URL
          }
          return response;
        } catch {
          const hit = (await cache.match(request.url)) || (await cache.match('/calendar'));
          if (hit) return hit;
          return new Response('Offline', {
            status: 503,
            headers: { 'content-type': 'text/plain' },
          });
        }
      })(),
    );
  }
});
