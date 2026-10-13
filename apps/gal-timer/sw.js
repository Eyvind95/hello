
const CACHE = 'gal-heart-v2';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Firebase、Google API 等跨網域請求不由 SW 攔截
  if (url.origin !== self.location.origin) return;

  // 只處理 Gal 計時器資料夾內的資源
  if (!url.pathname.startsWith('/hello/apps/gal-timer/')) return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(request);

      if (cached) return cached;

      return new Response('目前無法連線，請稍後重試。', {
        status: 503,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    })
  );
});

