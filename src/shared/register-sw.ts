/** Registers the offline service worker (production only: in dev it would cache stale builds). */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker
    .register('/sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // Once the page is idle, ask the worker to download every build file (the lazily loaded panel,
      // dialogs, ...) so they open offline. Not during the first load: it must not compete with it.
      const ask = () => registration.active?.postMessage({ type: 'precache' });
      if (typeof window.requestIdleCallback === 'function')
        window.requestIdleCallback(ask, { timeout: 5000 });
      else setTimeout(ask, 3000); // Safari has no requestIdleCallback
    })
    .catch(() => {
      /* offline support is an enhancement; the app works without it */
    });
}

/** Tells the worker to drop cached pages (the HTML belongs to one user). Call on sign-out. */
export function clearOfflineCache(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: 'clear' });
}
