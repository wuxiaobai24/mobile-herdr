// Only public application files are cached. API calls and writes always use the network.
const CACHE = 'mobile-herdr-shell-__BUILD_ID__';
const FILES = ['/', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png', .../*__BUILD_ASSETS__*/ []];
const PUBLIC_FILES = new Set(FILES);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()).catch(async error => { await caches.delete(CACHE); throw error; }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => {
    const previous = keys.filter(key => key.startsWith('mobile-herdr-shell-') && key !== CACHE);
    return Promise.all([self.clients.claim(), ...previous.slice(0, -1).map(key => caches.delete(key))]);
  }));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.search || !PUBLIC_FILES.has(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(() => caches.match(event.request).then(response => response || Response.error())));
});
