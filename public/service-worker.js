const CACHE_NAME = "dreamphrasegpt-browser-v1";
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
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CACHE_URLS" || !Array.isArray(event.data.urls)) {
    return;
  }

  event.waitUntil(warmCache(event.data.urls));
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || requestUrl.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleAssetRequest(request));
});

async function handleNavigationRequest(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
    return response;
  } catch {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    return (await caches.match("./index.html")) ?? (await caches.match("./")) ?? Response.error();
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
    if (shouldCacheResponse(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cachedResponse ?? Response.error();
  }
}

async function refreshCachedRequest(request) {
  try {
    const response = await fetch(request);
    if (!shouldCacheResponse(response)) {
      return;
    }

    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch {
    // Keep the cached response when offline.
  }
}

function shouldCacheResponse(response) {
  return response.ok && response.type !== "opaque";
}

async function warmCache(urls) {
  const cache = await caches.open(CACHE_NAME);

  for (const url of urls) {
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
