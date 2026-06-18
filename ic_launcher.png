
const CACHE = "manatil-v1-7-ajustes-app-icono";
const ASSETS = ["./","./index.html","./style.css","./app.js","./manifest.json","./logo.png","./icon-192.png","./icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))));
self.addEventListener("fetch", e => e.respondWith(caches.match(e.request).then(r => r || fetch(e.request))));
