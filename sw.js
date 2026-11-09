/* build.mjs replaces this version with a hash of all offline assets. */
const VERSION = '__BUILD_VERSION__';
const CACHE_PREFIX = `kotoba-shell:${new URL(self.registration.scope).pathname}:`;
const CACHE_NAME = CACHE_PREFIX + VERSION;
const ASSETS = ['./', './index.html', './styles.css', './app.js', './core.js', './initial_words.json', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'];
const assetURLs = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url); url.search = ''; url.hash = '';
  // Public feeds are always fetched from the network by app.js, never cached here.
  if (!assetURLs.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(url.href);
    return cached || fetch(event.request);
  })());
});
