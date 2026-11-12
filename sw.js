// Offline support for the whole site (registered by every page via shared/offline.js).
// Network first, so an online visit always gets the newest files and refreshes the kept copy; the kept
// copy is used only when the network is unreachable. Every file served is kept as it goes by. On the
// deployed site, precache.json (written by the Pages workflow) lists every file, so installing this
// worker fetches them all at once and even a game never opened works offline.
'use strict';
const CACHE = 'penopi';
const SHELL = ['./', 'manifest.webmanifest', 'shared/paper.css', 'shared/fonts/Gaegu-Regular.woff2', 'shared/fonts/Gaegu-Bold.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL).catch(() => {});
    try {
      const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
      await c.addAll(list);
    } catch { /* not deployed (no list): files are kept as they are used */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match(new URL('./', req.url)) : Response.error()))),
  );
});
