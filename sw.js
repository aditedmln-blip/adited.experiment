/* =====================================================
   SERVICE WORKER — Monitoring Alat Berat
   Dinas PUPRPERKIM Kabupaten Malinau
   Versi: 1.0
   ===================================================== */

const CACHE_NAME = 'alat-berat-v1.0';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './js/app.js'
];

/* ---- INSTALL: cache semua aset saat pertama install ---- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

/* ---- ACTIVATE: bersihkan cache lama ---- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---- FETCH: strategi cache-first ---- */
self.addEventListener('fetch', event => {
  const url = event.request.url;

  /* Untuk request ke Apps Script API: selalu coba network */
  if (url.includes('script.google.com') || url.includes('cloudinary.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => response)
        .catch(() => new Response(
          JSON.stringify({ status: 'offline', message: 'Tidak ada koneksi internet' }),
          { headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  /* Untuk semua aset lain: cache-first */
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
          }
          return networkResponse;
        });
      })
      .catch(() => {
        if (event.request.destination === 'document') {
          return caches.match('./index.html');
        }
      })
  );
});

/* ---- MESSAGE: terima perintah dari app (misal: skipWaiting) ---- */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
