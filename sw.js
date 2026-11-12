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
// On activation, drop kept files that the deployed site no longer has (a game taken off the site must not
// live on in someone's offline copy). Without precache.json (not deployed) nothing is dropped.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    try {
      const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
      const keep = new Set(SHELL.concat(list).map((u) => new URL(u, self.registration.scope).href));
      const c = await caches.open(CACHE);
      for (const req of await c.keys()) {
        const u = new URL(req.url); u.search = '';
        if (!keep.has(u.href)) await c.delete(req);
      }
    } catch { /* offline or not deployed: keep everything */ }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // always ask the server (cheap: unchanged files come back as 304), so the browser's own cache of up to
  // 10 minutes (GitHub Pages sends max-age=600) can't show an old version, e.g. a game just taken off the site
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match(new URL('./', req.url)) : Response.error()))),
  );
});
