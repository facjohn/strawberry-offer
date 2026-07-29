// 현농프레쉬 오퍼계산기 Service Worker
const CACHE_VERSION = 'hn-v36';   // v36: 앱설정 탭(개명·국가 추가) + 배 산지 자동 추가(매트릭스·신규 내륙 V열)
const CORE_CACHE = CACHE_VERSION + '-core';
const RUNTIME_CACHE = CACHE_VERSION + '-runtime';

// 캐시할 핵심 파일 (앱 셸) — 오프라인 부팅에 필수인 로컬 자산만. 실패하면 install 자체를 실패시켜 브라우저가 재시도하게 함.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];
// 있으면 좋은 외부 자산 — 실패해도 install을 막지 않음 (기존에는 addAll이 원자적이라 폰트 CSS 하나 실패로
// 전체 프리캐시가 비고, 이어지는 activate가 구버전 캐시까지 지워 오프라인 부팅이 통째로 죽을 수 있었음)
const OPTIONAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700;900&family=JetBrains+Mono:wght@400;600&display=swap'
];

// ━━━ 설치: 핵심 파일 미리 캐시 ━━━
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then((cache) =>
        cache.addAll(CORE_ASSETS)   // 필수 자산 실패 = install 실패 (무음 삼킴 금지)
          .then(() => Promise.all(
            OPTIONAL_ASSETS.map(u => cache.add(u).catch(() => {}))
          ))
      )
      .then(() => self.skipWaiting())
  );
});

// ━━━ 활성화: 자기 앱(hn-)의 옛 캐시만 정리 ━━━
// Cache Storage는 origin 단위 공유 — 같은 github.io origin의 다른 앱 캐시를 지우지 않도록 접두사를 한정
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter(k => k.startsWith('hn-') && !k.startsWith(CACHE_VERSION))
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

  // GAS API·시트 GViz(출고리스트) 호출은 캐싱 안 함 (실시간 데이터)
  if (url.hostname.includes('script.google.com') ||
      url.hostname.includes('googleusercontent.com') ||
      url.hostname.includes('docs.google.com')) {
    return; // 브라우저 기본 처리
  }

  // 실시간 환율 API도 캐싱 안 함 — 오프라인에서 캐시된 응답이 '실시간' 환율로 표시되는 것 방지 (실패 시 앱이 시트 환율로 폴백)
  if (url.hostname.includes('cdn.jsdelivr.net') ||
      url.hostname.includes('currency-api.pages.dev')) {
    return;
  }

  // 같은 출처가 아닌 폰트만 stale-while-revalidate
  if (url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(cache => {
        // 조회는 전체 캐시(caches.match) — install 때 CORE_CACHE에 프리캐시한 폰트 CSS도 첫 오프라인 로드에서 잡히게. 저장은 RUNTIME_CACHE.
        return caches.match(event.request).then(cached => {
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
      .catch(() => caches.match(event.request).then(cached => {
        if (cached) return cached;
        // index.html 폴백은 문서 탐색(navigate)에만 — 스크립트/이미지 요청 실패에 HTML을 돌려주면
        // (예: 오프라인의 GViz JSONP) onerror 대신 파싱 오류·타임아웃으로 흘러 원인이 가려짐
        if (event.request.mode === 'navigate' || event.request.destination === 'document') {
          return caches.match('./index.html');
        }
        return Response.error();
      }))
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
