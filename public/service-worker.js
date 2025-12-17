// Service Worker DISABLED for debugging
// This will unregister any existing service workers

self.addEventListener('install', (event) => {
  console.log('[SW] Installing - will immediately activate and unregister');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activating - deleting all caches');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          console.log('[SW] Deleting cache:', cacheName);
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      console.log('[SW] All caches deleted, unregistering self');
      return self.registration.unregister();
    })
  );
});

self.addEventListener('fetch', (event) => {
  // Pass through - don't intercept anything
  return;
});