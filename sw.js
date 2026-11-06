// Guarda la propia aplicación para que abra aunque no haya conexión.
// Los mapas y las rutas siempre se piden a internet.
const VERSION = 'ciegosnav-v1';
const ARCHIVOS = [
  './', './index.html', './ayuda.html', './style.css', './app.js',
  './src/geo.js', './src/guia.js', './src/alinear.js', './src/audio.js',
  './manifest.webmanifest', './icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero para recibir siempre la última versión; la copia guardada, si falla la red.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        const copia = r.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copia));
        return r;
      })
      .catch(() => caches.match(e.request))
  );
});
