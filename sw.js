// 현농프레쉬 오퍼계산기 Service Worker
const CACHE_VERSION = 'hn-v12';
const CORE_CACHE = CACHE_VERSION + '-core';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// 캐시할 핵심 파일 (앱 셸)
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=JetBrains+Mono:wght@400;600&display=swap'
];

// ━━━ 설치: 핵심 파일 미리 캐시 ━━━
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) => cache.addAll(CORE_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      }))
      .then(() => self.skipWaiting())
  );
});

// ━━━ 활성화: 옛 캐시 정리 ━━━
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => !k.startsWith(CACHE_VERSION))
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ━━━ Fetch 전략 ━━━
// 1. GAS 호출 (script.google.com): 항상 네트워크 (캐시 안 함)
// 2. 폰트/이미지: stale-while-revalidate (캐시 우선, 백그라운드 갱신)
// 3. 어플 셸 (HTML/JSON): network-first 후 캐시 폴백
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // GAS API 호출은 캐싱 안 함 (실시간 데이터)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com')) {
    return; // 브라우저 기본 처리
  }

  // 같은 출처가 아닌 폰트만 stale-while-revalidate
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache => {
        return cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        });
      })
    );
    return;
  }

  // 어플 셸: network-first
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && event.request.method === 'GET') {
          const cloned = response.clone();
          caches.open(CORE_CACHE).then(cache => cache.put(event.request, cloned));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});

// ━━━ 푸시 알림 수신 ━━━
self.addEventListener('push', (event) => {
  let data = { title: '현농오퍼', body: '새 알림이 있습니다' };
  try {
    if (event.data) data = event.data.json();
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title || '현농오퍼', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      vibrate: [100, 50, 100],
      data: data.url || './index.html',
      tag: 'hn-offer',
      renotify: true
    })
  );
});

// ━━━ 알림 클릭 ━━━
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      for (const c of clients) {
        if (c.url.includes(event.notification.data || './') && 'focus' in c) {
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(event.notification.data || './');
      }
    })
  );
});

// ━━━ 백그라운드 동기화 (선택) ━━━
self.addEventListener('sync', (event) => {
  if (event.tag === 'hn-sync') {
    // 향후 백그라운드 시트 동기화 로직 가능
  }
});
