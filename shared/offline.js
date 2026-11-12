// Works offline once opened: a service worker at the site root keeps a copy of every file it has served
// (and, on a deployed site, every file listed in precache.json). See sw.js.
export function offline() {
  if (!('serviceWorker' in navigator) || !location.protocol.startsWith('http')) return;
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url)).catch(() => {});
}
