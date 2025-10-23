self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => clients.claim());
// 先純網路，不做快取
self.addEventListener('fetch', () => {});
