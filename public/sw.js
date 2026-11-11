/* global importScripts */
/* Offline support: lets the calendar page load while the network is down, so the queued changes
 * (kept in IndexedDB) can be shown again and sent later. API calls are never cached: the app itself
 * handles their failure (it queues the change). */
const STATIC = 'static-v1';
const PAGES = 'pages-v1';

// The list of every build file (generated after the build; missing in development).
try {
  importScripts('/precache.js');
} catch {
  self.PRECACHE = [];
}

/** Downloads every build file once, so even a chunk the page never loaded online is there offline. */
async function precache() {
  const cache = await caches.open(STATIC);
  await Promise.all(
    (self.PRECACHE || []).map(async (path) => {
      if (await cache.match(path)) return;
      try {
        const response = await fetch(path);
        if (response.ok) await cache.put(path, response);
      } catch {
        // Best effort: whatever is missing is fetched (and cached) when it is first needed online.
      }
    }),
  );
  // Forget files of older builds.
  const wanted = new Set(self.PRECACHE || []);
  if (wanted.size > 0)
    for (const request of await cache.keys())
      if (!wanted.has(new URL(request.url).pathname)) await cache.delete(request);
}

// Installing and activating stay instant: the worker takes control of the page at once, as it always
// did. Precaching inside `install` delayed that takeover until all files were downloaded, and a worker
// that takes over in the middle of the page's own first requests can make some of them fail (WebKit
// reports "due to access control checks"). The page asks for the precache when it is idle instead.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The page asks us to forget the cached HTML on sign-out: it belongs to one user. The build files in
// STATIC are the same for everybody and stay.
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'clear') event.waitUntil(caches.delete(PAGES));
  if (event.data.type === 'precache') event.waitUntil(precache());
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
