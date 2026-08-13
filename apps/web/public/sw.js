/// <reference lib="webworker" />

const CACHE_NAME = "home-network-monitor-v1";

// Assets to pre-cache on install
const PRECACHE_ASSETS = ["/", "/manifest.webmanifest"];

// Install event - pre-cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Fetch event - network first strategy
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Cache only same-origin http(s) requests.
  if (url.origin !== self.location.origin) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Skip API requests
  if (url.pathname.startsWith("/api/")) return;

  // Skip dev HMR stream endpoints.
  if (url.pathname.startsWith("/_next/webpack-hmr")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET requests
        if (response.status === 200) {
          const responseToCache = response.clone();
          event.waitUntil(
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseToCache))
              .catch(() => {
                // Ignore cache write failures
              }),
          );
        }

        return response;
      })
      .catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request).then((cached) => cached || Response.error());
      }),
  );
});

// Listen for skip waiting message
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
