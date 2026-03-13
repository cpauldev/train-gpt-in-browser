const CACHE_NAME = "dreamphrasegpt-browser-v1";
const CACHE_URLS_MESSAGE_TYPE = "CACHE_URLS";
const NAVIGATION_FALLBACKS = ["./index.html", "./"];
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./dreamphrasegpt.png",
  "./datasets/english_words.txt",
  "./datasets/us_baby_names.txt",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateServiceWorker());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== CACHE_URLS_MESSAGE_TYPE || !Array.isArray(event.data.urls)) {
    return;
  }

  event.waitUntil(warmCache(event.data.urls));
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);

  if (!isCacheableRequest(request, requestUrl)) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleAssetRequest(request));
});

async function precacheAppShell() {
  const cache = await openAppCache();
  await cache.addAll(PRECACHE_URLS);
  await self.skipWaiting();
}

async function activateServiceWorker() {
  const cacheKeys = await caches.keys();
  await Promise.all(
    cacheKeys.filter((cacheKey) => cacheKey !== CACHE_NAME).map((cacheKey) => caches.delete(cacheKey)),
  );
  await self.clients.claim();
}

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    await cacheResponse(request, response);
    return response;
  } catch {
    return (await matchCachedRequest([request, ...NAVIGATION_FALLBACKS])) ?? Response.error();
  }
}

async function handleAssetRequest(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    void refreshCachedRequest(request);
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    await cacheResponse(request, response);
    return response;
  } catch {
    return cachedResponse ?? Response.error();
  }
}

async function refreshCachedRequest(request) {
  try {
    const response = await fetch(request);
    await cacheResponse(request, response);
  } catch {
    // Keep the cached response when offline.
  }
}

async function warmCache(urls) {
  const cache = await openAppCache();
  const uniqueUrls = [...new Set(urls)];

  for (const url of uniqueUrls) {
    try {
      const request = new Request(url, { credentials: "same-origin" });
      const response = await fetch(request);

      if (shouldCacheResponse(response)) {
        await cache.put(request, response.clone());
      }
    } catch {
      // Ignore warm-cache failures.
    }
  }
}

async function cacheResponse(request, response) {
  if (!shouldCacheResponse(response)) {
    return;
  }

  const cache = await openAppCache();
  await cache.put(request, response.clone());
}

async function matchCachedRequest(candidates) {
  for (const candidate of candidates) {
    const response = await caches.match(candidate);
    if (response) {
      return response;
    }
  }

  return null;
}

function isCacheableRequest(request, requestUrl) {
  return request.method === "GET" && requestUrl.origin === self.location.origin;
}

function shouldCacheResponse(response) {
  return response.ok && response.type !== "opaque";
}

function openAppCache() {
  return caches.open(CACHE_NAME);
}
