// Offline support: cache-first for the app shell, stale-while-revalidate for
// fonts and team logos.
const VERSION = 'hlc-v0.156.2';
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
  'js/traderules.js', 'js/regression.js', 'js/skillinfo.js', 'js/autoplay.js', 'js/leagueexport.js', 'js/settle.js', 'js/leaguepack.js', 'js/leaguetemplate.js', 'js/plays.js', 'js/coachprofile.js', 'js/coachmarket.js', 'js/schemeevo.js', 'js/names.js', 'js/gear.js', 'js/scoring.js',
  'js/realpicks.js', 'js/influence.js',
  'js/facilities.js',
  'js/predraft.js',
  'js/presser.js',
  'js/survey.js',
  'js/freeagency.js',
  'js/phases.js',
  'js/summer.js',
  'js/overview.js',
  'js/traits.js',
  'js/college.js',
  'js/coaching.js',
  'js/recruits.js',
  'js/recruiting.js',
  'js/appearance-pool.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/hoopland-logo.png',
  'icons/nba.png',
  'icons/pro-logo.png',
  'icons/nba-px.png',
  'icons/banner.jpg',
  'icons/league-ball.png',
  'icons/bg-tile.jpg',
  'icons/hero-camp.jpg',
  'icons/hero-mentor.jpg',
  'icons/hero-media.jpg',
  'icons/alert.png',
  'icons/hero-fa.jpg',
  'icons/app-180.png',
  'icons/app-192.png',
  'icons/app-512.png',
  ...Array.from({ length: 102 }, (_, i) => `img/plays/${i}.png`),
];

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's HTTP cache, so an update never
  // stores a stale copy of a file next to new ones.
  // Each file is cached on its own: one missing file must never block an
  // update (addAll fails the whole install if any request fails).
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
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
