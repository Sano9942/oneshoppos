// v2 — Phase 7.12: replace vite.svg with real favicon set + add OG image to
// the precache. Bump on each precache-list change to evict stale entries
// from the activate-handler purge.
const STATIC_CACHE = "sanopos-static-v2";
const API_CACHE = "sanopos-api-v1";
const STATIC_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon.svg",
  "/favicon.ico",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/og-default.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "AUTH_LOGOUT") {
    event.waitUntil(caches.delete(API_CACHE));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.mode === "navigate" && sameOrigin) {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(STATIC_CACHE);
        return cache.match("/") || Response.error();
      })
    );
    return;
  }

  if (sameOrigin) {
    const isStaticAsset =
      url.pathname.startsWith("/assets/") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname.endsWith(".svg") ||
      url.pathname.endsWith(".png");
    if (isStaticAsset) {
      event.respondWith(cacheFirst(request));
      return;
    }
  }
});
