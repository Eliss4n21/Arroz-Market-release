/* ═══════════════════════════════════════════════════════════
   ArrozMarket — Service Worker v1.0
   Responsabilidades:
   1. Cache offline das páginas principais
   2. Recebe push notifications e exibe ao usuário
   3. Ao clicar na notificação, abre o site
═══════════════════════════════════════════════════════════ */

const CACHE_NAME   = 'arrozmarket-v2';
const CACHE_ASSETS = ['/', '/index.html'];

/* ── Instalação: pré-cache dos assets principais ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_ASSETS))
  );
  self.skipWaiting();
});

/* ── Activação: remove caches antigos ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch: serve cache se offline, senão rede ── */
self.addEventListener('fetch', event => {
  // Só cacheia GET e não cacheia /api/
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});

/* ── Push notification recebida ── */
self.addEventListener('push', event => {
  let payload = { title: '🌾 ArrozMarket', body: 'Novo episódio disponível!', tag: 'novo-ep' };
  try { payload = { ...payload, ...event.data.json() }; } catch {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body:    payload.body,
      icon:    '/icon-192.png',
      badge:   '/icon-72.png',
      tag:     payload.tag  || 'am-notif',
      data:    { url: payload.url || '/' },
      actions: [{ action:'abrir', title:'Ouvir agora' }],
    })
  );
});

/* ── Clique na notificação ── */
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      const existing = list.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
