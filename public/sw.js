// Jarvis Command Center — service worker.
// Goal (per the audit): on flaky mobile data the installed PWA should show the
// LAST-KNOWN screen instead of a blank error. Strategy is deliberately
// conservative for an authed, per-user dashboard:
//   - static build assets (/_next/static, icons): cache-first (immutable).
//   - page navigations: network-FIRST, fall back to the last cached copy only
//     when the network fails — so you never see stale data while online, but you
//     keep a usable view offline.
//   - never cache API/auth/login or non-GET/cross-origin requests.

const VERSION = "jarvis-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;

self.addEventListener("install", (e) => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/icon" ||
    url.pathname === "/apple-icon" ||
    url.pathname === "/manifest.webmanifest"
  );
}

function isNeverCache(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/login")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  if (isNeverCache(url)) return; // auth/data: always hit the network, never cache

  // Immutable build assets — cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Page navigations — network-first, fall back to last cached copy offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res && res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cache = await caches.open(PAGE_CACHE);
          const cached = await cache.match(request);
          if (cached) return cached;
          return new Response(
            "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><body style='background:#000;color:#999;font-family:ui-monospace,monospace;display:grid;place-items:center;height:100vh;margin:0'><div style='text-align:center'><div style='color:#666;letter-spacing:.2em;font-size:12px'>JARVIS</div><p>Offline — no cached copy of this page yet.</p></div></body>",
            { headers: { "Content-Type": "text/html" }, status: 503 }
          );
        }
      })()
    );
  }
});
