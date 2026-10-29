// Service worker minimale: rende l'app installabile e apre anche offline.
// Le richieste a Firestore NON passano di qui (le gestisce l'SDK con la sua cache).
const CACHE = "prove-v40";
const SHELL = ["./", "index.html", "styles.css", "app.js", "diretta.js", "config.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/badge-96.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // Firestore, font, SDK: rete diretta
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // funzioni: mai in cache
  if (url.pathname.endsWith("/version.json")) return;                             // controllo versione: sempre dalla rete
  if (url.searchParams.has("fan")) return;                                       // link d'invito: contiene la password, niente cache
  // network-first: prendi sempre l'ultima versione, cache come ripiego offline
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match("index.html")))
  );
});

// ---------- notifiche push (vedi functions/notifiche.js) ----------
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { testo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.titolo || "Il ritmo della sala prove", {
    body: d.testo || "",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || undefined,
    data: { url: d.url || "./" }
  }));
});
// tocco sulla notifica: l'app (già aperta o da aprire) va alla pagina giusta
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const aperte = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const app = aperte.find(c => c.url.startsWith(self.registration.scope));
    if (app) { app.postMessage({ tipo: "vai", url }); return app.focus(); }
    return self.clients.openWindow(url);
  })());
});

