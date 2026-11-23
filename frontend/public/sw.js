const CACHE_STATIC = 'reservasaas-static-v3';
const CACHE_API = 'reservasaas-api-v3';

const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg'
];

// Instalación: precacheo del App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// Activación: limpieza de versiones antiguas de caché
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_STATIC && k !== CACHE_API)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Estrategia híbrida: Network-First para API GET / Cache-First para estáticos
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Solo cacheamos peticiones GET
  if (request.method !== 'GET') return;

  // Consultas a la API: intenta red primero; si está offline devuelve última copia cacheada
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          const clone = networkResponse.clone();
          caches.open(CACHE_API).then((cache) => cache.put(request, clone));
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Archivos estáticos y vistas: Cache-First con actualización en segundo plano
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_STATIC).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => cached || caches.match('/index.html'));

      return cached || networkFetch;
    })
  );
});