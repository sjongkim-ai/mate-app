// TripMate PWA service worker
// 캐시 전략:
//   - API/auth/admin: 통과 (서비스워커가 가로채지 않음)
//   - 페이지 이동(navigate): 네트워크 우선, 실패 시 offline.html
//   - 정적 자산(GET, same-origin): 캐시 우선, 백그라운드 갱신
const CACHE = 'tripmate-v1';
const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-maskable.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // 서버 API/인증/관리자 API는 SW에서 가로채지 않음
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin/api/') ||
    url.pathname.startsWith('/auth/')
  ) {
    return;
  }

  // 페이지 이동: 네트워크 우선, 실패 시 캐시된 페이지 또는 오프라인 폴백
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/offline.html')))
    );
    return;
  }

  // 그 외 정적 자산: 캐시 우선, 백그라운드에서 갱신
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

// Web Push 핸들러 (서버에서 push 구독 후 발송 시 동작)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'TripMate', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'TripMate';
  const options = {
    body: data.body || '',
    icon: '/icons/icon.svg',
    badge: '/icons/icon.svg',
    data: { url: data.url || '/' },
    tag: data.tag,
    renotify: !!data.tag,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

// 페이지에서 즉시 활성화 메시지 받으면 reload 없이 새 SW로 전환
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
