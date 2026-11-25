const CACHE='gal-archive-pwa-v131';
const HOME='/hello/apps/gal-archive/index.html';
const PRECACHE=[HOME,'/hello/apps/gal-archive/time-machine.js','/hello/apps/gal-archive/archive-observatory-core.js','/hello/apps/gal-archive/archive-auto-sync-core.js','/hello/apps/gal-archive/archive-auto-sync.js','/hello/apps/gal-archive/archive-observatory.js','/hello/apps/gal-archive/archive-observatory.css','/hello/apps/gal-archive/handover.js','/hello/apps/gal-archive/handover-cloud.js','/hello/apps/gal-archive/complete-backup.js','/hello/apps/gal-archive/archive-reconcile.js','/hello/apps/gal-archive/chrome-extension/gal-core.js?v=0.10.1','/hello/apps/gal-archive/chrome-extension/gal-format-evidence.js?v=0.10.1','/hello/apps/gal-archive/archive-replay.js?v=9','/hello/apps/gal-archive/manifest.webmanifest','/hello/apps/ledger/6.png','/hello/apps/ledger/8.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('gal-archive-pwa-')&&k!==CACHE)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const u=new URL(request.url);
  if(u.origin!==self.location.origin||!u.pathname.startsWith('/hello/apps/gal-archive/'))return;
  event.respondWith((async()=>{try{const response=await fetch(request,{cache:'no-store'});if(response.ok){const cache=await caches.open(CACHE);await cache.put(request,response.clone())}return response}catch(e){return await caches.match(request,{ignoreSearch:true})||await caches.match(HOME)||new Response('離線時無法載入檔案館，請連網後重試。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}})());
});
