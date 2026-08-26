/* THE CIRCLE — Service Worker: Cache-first fuer Film-Frames und Media.
 * Erster Besuch fuellt den Cache, jeder weitere laedt ohne Netz — sofort. */
const CACHE = "circle-film-v2";
const ASSET = /\/(seq4|seqp5|seqm4|media)\//;

self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (!ASSET.test(url.pathname)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(e.request);
      if (hit) return hit;
      const resp = await fetch(e.request);
      if (resp.ok) cache.put(e.request, resp.clone());
      return resp;
    })
  );
});
