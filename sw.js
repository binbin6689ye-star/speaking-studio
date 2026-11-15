// Offline support: the app shell is cached on install; audio, the speech model and engine files are cached the first time they're used.
const SHELL = "ss-shell-v3", MEDIA = "ss-media-v1";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./data.js", "./stt-worker.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./vendor/transformers.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![SHELL, MEDIA].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const media = /\/(audio|models|vendor)\//.test(url.pathname);
  if (!media) {
    e.respondWith((async () => {
      try { const res = await fetch(e.request, { cache: "no-cache" }); if (res.ok) (await caches.open(SHELL)).put(e.request, res.clone()); return res; }
      catch (err) { return (await caches.match(e.request, { ignoreSearch: true })) || caches.match("./index.html"); }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && media) (await caches.open(MEDIA)).put(e.request, res.clone());
      return res;
    } catch (err) {
      if (e.request.mode === "navigate") return caches.match("./index.html");
      throw err;
    }
  })());
});
