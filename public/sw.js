const CACHE='news-v5';
self.addEventListener('install',e=>{self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k)))));e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).then(res=>{const r=res.clone();caches.open(CACHE).then(c=>c.put(e.request,r));return res}).catch(()=>caches.match(e.request)))
});
