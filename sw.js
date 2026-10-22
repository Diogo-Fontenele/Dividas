/* Service Worker: funciona offline e avisa vencimentos (quando o Android permitir). */
importScripts('logic.js');

const CACHE = 'pf-v2';
const ASSETS = ['./', 'index.html', 'style.css', 'logic.js', 'db.js', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache primeiro, atualizando em segundo plano.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

function lerDividas() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('planejamento-familiar');
    r.onupgradeneeded = (ev) => ev.target.transaction.abort(); // banco ainda não existe
    r.onerror = () => resolve([]);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('dividas')) { db.close(); return resolve([]); }
      const q = db.transaction('dividas').objectStore('dividas').getAll();
      q.onsuccess = () => { db.close(); resolve(q.result); };
      q.onerror = () => { db.close(); reject(q.error); };
    };
  });
}

async function avisarVencimentos() {
  const hoje = Logic.todayISO();
  const dividas = await lerDividas();
  const hojeLista = Logic.vencendoHoje(dividas, hoje);
  const atras = Logic.atrasadas(dividas, hoje);
  if (!hojeLista.length && !atras.length) return;
  const partes = [];
  if (hojeLista.length) partes.push(`Vence hoje: ${hojeLista.map((o) => o.d.nome).join(', ')}`);
  if (atras.length) partes.push(`${atras.length} em atraso`);
  await self.registration.showNotification('Planejamento Familiar', {
    body: partes.join(' · '), icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'vencimentos-' + hoje,
  });
}

self.addEventListener('periodicsync', (e) => { if (e.tag === 'vencimentos') e.waitUntil(avisarVencimentos()); });
self.addEventListener('message', (e) => { if (e.data === 'checar-vencimentos') e.waitUntil(avisarVencimentos()); });

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs.length ? cs[0].focus() : self.clients.openWindow('./index.html'))));
});
