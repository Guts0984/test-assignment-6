/** Registers the offline service worker (production only: in dev it would cache stale builds). */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  void navigator.serviceWorker.register('/sw.js').catch(() => {
    /* offline support is an enhancement; the app works without it */
  });
}

/** Tells the worker to drop cached pages (the HTML belongs to one user). Call on sign-out. */
export function clearOfflineCache(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.controller?.postMessage({ type: 'clear' });
}
