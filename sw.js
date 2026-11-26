// Offline-Cache: App-Shell zuerst aus dem Cache, im Hintergrund aktualisieren.
const CACHE = 'sport-v0.6.0';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'sync.js', 'mensa.js', 'yazio.js', 'yazio-config.js', 'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Eigene Dateien + Firebase-Bibliothek (gstatic) offline vorhalten; Firebase-APIs selbst nie cachen
  const lib = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (e.request.method !== 'GET' || (url.origin !== location.origin && !lib)) return;
  // Daten (Mensaplan): erst Netz, offline aus dem Cache
  if (url.origin === location.origin && url.pathname.includes('/data/')) {
    e.respondWith(caches.open(CACHE).then(c => fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })
      .catch(() => c.match(e.request, { ignoreSearch: true }))));
    return;
  }
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || fresh;
  }));
});
