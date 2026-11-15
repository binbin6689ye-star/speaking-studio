// Offline: network first for the app files (so updates arrive), cached copy when offline.
const CACHE = "yue-v1";
const FILES = ["./", "./index.html", "./app.css", "./app.js", "./data.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith((async () => {
    try { const res = await fetch(e.request, { cache: "no-cache" }); if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone()); return res; }
    catch (err) { return (await caches.match(e.request, { ignoreSearch: true })) || caches.match("./index.html"); }
  })());
});
