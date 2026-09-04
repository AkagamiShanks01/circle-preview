/* THE CIRCLE — Service Worker: Cache-first fuer Film-Frames und Media.
 * Erster Besuch fuellt den Cache, jeder weitere laedt ohne Netz — sofort. */
const CACHE = "circle-film-v8";
const ASSET = /\/(seq8|seqm8|seqc8|seqp8|seq7|seqm7|seqc7|seqp6|seq6|seqm6|seq4|seqp4|seqm4|media)\//;

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
