/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Self-unregistering service worker to clear any stale cache
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    }).then(() => self.clients.claim()).then(() => {
      return self.registration.unregister();
    })
  );
});
