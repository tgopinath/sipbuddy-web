// SipBuddy service worker: network first with an offline copy; the MediaPipe runtime and models are cached after first use.
const CACHE = 'sipbuddy-v1';
const CORE = ['./', './index.html', './app.css', './app.js', './messages.js', './planner.js', './detector.js', './manifest.json',
  './kolam/tokens.css', './kolam/kolam.css', './kolam/m3/kolam-m3.js', './kolam/m3/kolam-m3.css', './kolam/ios/kolam-ios.js', './kolam/ios/kolam-ios.css',
  './icons/icon-192.png', './icons/icon-512.png', './favicon.png', './apple-touch-icon.png'];
const CACHEABLE = u => u.origin === location.origin || u.hostname === 'cdn.jsdelivr.net' || u.hostname === 'storage.googleapis.com' || u.hostname.startsWith('fonts.');
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (!CACHEABLE(u)) return;
  // The models and the versioned runtime never change: cache first. Everything else: network first.
  if (u.hostname === 'storage.googleapis.com' || u.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })));
    return;
  }
  e.respondWith(fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(r, c)); } return res; })
    .catch(() => caches.match(r).then(m => m || (r.mode === 'navigate' ? caches.match('./index.html') : undefined))));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.focus(); c.postMessage('open-reminder'); return; }
    return self.clients.openWindow('./?open=reminder');
  }));
});
