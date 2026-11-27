/* Daily Space offline app-shell worker.
 * Keeps the application shell available offline and caches versioned public assets.
 * Private Firebase user documents and API responses are deliberately not cached here.
 */
'use strict';
const SHELL_CACHE = 'daily-space-shell-v1';
const STATIC_CACHE = 'daily-space-static-v1';
const SHELL_URLS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL_URLS.map(async url => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok) await cache.put(url, response.clone());
      } catch (_) { /* A missing optional shell asset must not block installation. */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('daily-space-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Do not store private medical documents, Firebase database calls, authentication,
  // AI requests, or other user-specific API responses in the app-shell cache.
  if (/firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|generativelanguage\.googleapis\.com|firebasestorage\.googleapis\.com/.test(url.hostname)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put('./index.html', response.clone());
        }
        return response;
      } catch (_) {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const publicCdn = ['www.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com', 'cdn.tailwindcss.com', 'esm.sh'].includes(url.hostname);
  const isStaticAsset = /\.(?:css|js|mjs|json|svg|png|jpe?g|webp|gif|woff2?)$/i.test(url.pathname);
  if ((sameOrigin && isStaticAsset) || publicCdn) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request);
      if (cached) {
        if (navigator.onLine) fetch(request).then(response => {
          if (response && (response.ok || response.type === 'opaque')) cache.put(request, response.clone());
        }).catch(() => {});
        return cached;
      }
      try {
        const response = await fetch(request);
        if (response && (response.ok || response.type === 'opaque')) await cache.put(request, response.clone());
        return response;
      } catch (_) {
        return Response.error();
      }
    })());
  }
});
