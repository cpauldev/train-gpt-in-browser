import { resolveBasePath } from "@/lib/utils";

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  if (import.meta.env.MODE === "test") {
    return;
  }

  const serviceWorkerUrl = resolveBasePath("service-worker.js");
  const serviceWorkerScope = resolveBasePath("");

  window.addEventListener("load", () => {
    void requestPersistentStorage();
    void navigator.serviceWorker
      .register(serviceWorkerUrl, {
        scope: serviceWorkerScope,
      })
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        registration.active?.postMessage({
          type: "CACHE_URLS",
          urls: collectWarmCacheUrls(),
        });
      });
  });
}

async function requestPersistentStorage() {
  if (!("storage" in navigator) || typeof navigator.storage.persist !== "function") {
    return;
  }

  try {
    await navigator.storage.persist();
  } catch {
    // Persistence is best-effort.
  }
}

function collectWarmCacheUrls() {
  const urls = new Set<string>([
    window.location.href,
    new URL(resolveBasePath(""), window.location.href).toString(),
    new URL(resolveBasePath("index.html"), window.location.href).toString(),
  ]);

  for (const element of document.querySelectorAll<
    HTMLLinkElement | HTMLImageElement | HTMLScriptElement
  >("link[href], img[src], script[src]")) {
    const value = "href" in element ? element.href : element.src;
    if (value) {
      urls.add(value);
    }
  }

  for (const entry of performance.getEntriesByType("resource")) {
    if ("name" in entry && typeof entry.name === "string") {
      urls.add(entry.name);
    }
  }

  return Array.from(urls);
}
