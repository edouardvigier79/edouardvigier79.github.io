/* Service worker — cache hors-ligne + réception des photos partagées depuis la galerie */
/* abraCADabra — application version 3.0 */
const CACHE = "chantier-v63";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable.png",
  "./fond-plan.jpg", "./logo.png", "./logo-dark.png", "./pdf.min.js", "./pdf.worker.min.js"];

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

/* Même base locale que l'application, mais SANS numéro de version : le service worker n'a
   besoin que du magasin « inbox » pour déposer les photos partagées. Fixer une version ici
   obligeait à la synchroniser avec index.html à chaque évolution du schéma, et levait une
   VersionError dès que l'application prenait de l'avance. C'est elle qui crée les magasins. */
function openDb(){
  return new Promise((res, rej) => {
    const rq = indexedDB.open("chantier-notes");
    rq.onupgradeneeded = e => {
      // première ouverture sur cet appareil : au minimum de quoi recevoir un partage
      const d = e.target.result;
      if (!d.objectStoreNames.contains("inbox")){
        d.createObjectStore("inbox", {keyPath:"id", autoIncrement:true});
      }
    };
    rq.onsuccess = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains("inbox")){
        d.close();
        rej(new Error("magasin inbox absent — ouvrez l'application une fois"));
        return;
      }
      res(d);
    };
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

  /* Ouverture de l'application : réseau d'abord, cache en secours.
     C'est ce qui rend le portail d'authentification réellement utile — sans cela un appareil
     déjà installé rouvrirait l'application depuis son cache même après retrait de l'autorisation.
     En secours immédiat sur coupure ou signal trop faible : le chantier reste prioritaire. */
  if (e.request.mode === "navigate"){
    e.respondWith(ouverture(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request, {ignoreSearch:true}).then(hit =>
      hit || fetch(e.request).then(resp => {
        if (cacheable(e.request, resp)){
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return resp;
      })
    )
  );
});

const DELAI_RESEAU = 3500; // au-delà, on ouvre depuis le cache : pas d'attente sur un signal faible

async function ouverture(req){
  let resp;
  try{
    resp = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error("délai dépassé")), DELAI_RESEAU))
    ]);
  }catch{
    /* hors ligne, ou réseau trop lent : l'application mise en cache */
    const hit = await caches.match(req, {ignoreSearch:true})
             || await caches.match("./index.html")
             || await caches.match("./");
    if (hit) return hit;
    return new Response("Application indisponible hors ligne.", {status:503, headers:{"content-type":"text/plain; charset=utf-8"}});
  }
  /* renvoyé vers la page de connexion du portail : y conduire le navigateur.
     On reconstruit la redirection, une réponse « redirected » étant refusée pour une navigation. */
  if (resp.redirected) return Response.redirect(resp.url, 302);
  /* refus explicite du portail (403) : afficher le refus, surtout pas le cache */
  if (!resp.ok) return resp;
  if (cacheable(req, resp)){
    const copie = resp.clone();
    caches.open(CACHE).then(c => c.put(req, copie)).catch(() => {});
  }
  return resp;
}

/* Ne mémoriser qu'une vraie réponse du site.
   Derrière un portail d'authentification (Cloudflare Access), une session expirée
   renvoie la page de connexion à la place du fichier : la mettre en cache sous le nom
   de index.html ou de pdf.min.js casserait l'application de façon irrécupérable. */
function cacheable(req, resp){
  if (!resp || !resp.ok) return false;                 // 4xx/5xx, y compris le 302 suivi jusqu'à une erreur
  if (resp.redirected) return false;                   // redirigé ailleurs : ce n'est pas la ressource demandée
  if (resp.type !== "basic") return false;             // opaque, cors, opaqueredirect
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const path = new URL(req.url).pathname;
  const estPage = req.mode === "navigate" || /\/$|\.html?$/i.test(path);
  /* du HTML servi à la place d'un script, d'une image ou du manifeste = page d'interstitiel */
  if (!estPage && ct.includes("text/html")) return false;
  return true;
}
