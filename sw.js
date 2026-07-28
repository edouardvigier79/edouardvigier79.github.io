/* Service worker — cache hors-ligne + réception des photos partagées depuis la galerie */
/* abraCADabra — application version 3.0 */
const CACHE = "chantier-v31";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable.png", "./fond-plan.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* même base locale que l'application — garder la MÊME version que index.html (4) pour éviter un VersionError */
function openDb(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open("chantier-notes", 5);
    rq.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("visits")){
        const v = d.createObjectStore("visits", {keyPath:"id", autoIncrement:true});
        v.createIndex("date","date");
      }
      if (!d.objectStoreNames.contains("photos")){
        const p = d.createObjectStore("photos", {keyPath:"id", autoIncrement:true});
        p.createIndex("visitId","visitId");
      }
      if (!d.objectStoreNames.contains("inbox")){
        d.createObjectStore("inbox", {keyPath:"id", autoIncrement:true});
      }
      if (!d.objectStoreNames.contains("projects")){
        d.createObjectStore("projects", {keyPath:"id", autoIncrement:true});
      }
      if (!d.objectStoreNames.contains("reserves")){
        const r = d.createObjectStore("reserves", {keyPath:"id", autoIncrement:true});
        r.createIndex("projectId","projectId");
      }
      if (!d.objectStoreNames.contains("annexes")){
        const a = d.createObjectStore("annexes", {keyPath:"id", autoIncrement:true});
        a.createIndex("projectId","projectId");
      }
      if (!d.objectStoreNames.contains("controls")){
        const c = d.createObjectStore("controls", {keyPath:"id", autoIncrement:true});
        c.createIndex("projectId","projectId");
        c.createIndex("visitId","visitId");
      }
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  /* photos reçues via « Partager vers Chantier » */
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname.endsWith("/share-target")){
    e.respondWith((async () => {
      try{
        const form = await e.request.formData();
        const files = form.getAll("photos").filter(f => f && f.size);
        if (files.length){
          const d = await openDb();
          await new Promise((res, rej) => {
            const t = d.transaction("inbox", "readwrite");
            for (const f of files){
              t.objectStore("inbox").add({blob: f, name: f.name || "", type: f.type || "image/jpeg", at: Date.now()});
            }
            t.oncomplete = res;
            t.onerror = () => rej(t.error);
          });
        }
      }catch{}
      return Response.redirect("./", 303);
    })());
    return;
  }

  if (e.request.method !== "GET") return;
  if (url.origin !== location.origin) return; // API Anthropic, BAN, liens externes : réseau direct
  e.respondWith(
    caches.match(e.request, {ignoreSearch:true}).then(hit =>
      hit || fetch(e.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return resp;
      })
    )
  );
});
