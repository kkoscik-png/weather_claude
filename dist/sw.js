// Baltic Wind & Waves service worker: installable app, instant start and an offline shell.
// Forecast data is not cached here (the app keeps the last forecast itself); map tiles go
// straight to OpenStreetMap.
const VERSION = 'baltic-shell-v1';
const SHELL = ['/', '/index.html', '/theme.js', '/manifest.webmanifest', '/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/assets/leaflet.css', '/assets/leaflet.js', '/assets/land.json', '/assets/coast.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Pages: always try the network first so a new version shows at once; offline → cached page.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(c => c.put('/', copy)); }
      return response;
    }).catch(() => caches.match('/').then(r => r || caches.match('/index.html'))));
    return;
  }
  // Versioned files (?v=…) never change: cache first. Other files: network first, cache as fallback.
  if (url.searchParams.has('v')) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(c => c.put(request, copy)); }
      return response;
    })));
    return;
  }
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(VERSION).then(c => c.put(request, copy)); }
    return response;
  }).catch(() => caches.match(request)));
});
