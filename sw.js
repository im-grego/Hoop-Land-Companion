// Offline support: cache-first for the app shell, stale-while-revalidate for
// fonts and team logos.
const VERSION = 'hlc-v0.27.5';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/savefile.js',
  'js/progression.js',
  'js/draft.js',
  'js/mentorship.js',
  'js/storylines.js',
  'js/dropbox.js',
  'js/livedraft.js',
  'js/trades.js',
  'js/freeagency.js',
  'js/phases.js',
  'js/summer.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/hoopland-logo.png',
  'icons/nba.png',
  'icons/banner.jpg',
  'icons/league-ball.png',
  'icons/bg-tile.jpg',
  'icons/hero-camp.jpg',
  'icons/hero-media.jpg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so an update never
  // stores a stale copy of a file next to new ones.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
    return;
  }
  e.respondWith(
    caches.open(VERSION).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
