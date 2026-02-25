const STATIC_CACHE = "oneshop-static-v1";
const API_CACHE = "oneshop-api-v1";
const STATIC_ASSETS = ["/", "/manifest.webmanifest", "/vite.svg"];

function shouldCacheApiPath(pathname) {
  const allow = [
    "/api/feature-flags",
    "/api/outlets",
    "/api/categories",
    "/api/brands",
    "/api/taxes",
    "/api/products",
    "/api/reports/dashboard",
    "/api/notifications/count",
  ];
  return allow.some((prefix) => pathname.startsWith(prefix));
}

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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    fetchPromise.catch(() => {});
    return cached;
  }
  const fresh = await fetchPromise;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ error: "Offline and no cached response available" }), {
    status: 503,
    headers: { "Content-Type": "application/json" },
  });
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

  if (sameOrigin && url.pathname.startsWith("/api/") && shouldCacheApiPath(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
