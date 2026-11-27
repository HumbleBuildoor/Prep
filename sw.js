// Service worker: keeps a copy of the app on the device so it opens with no connection.
// VERSION changes whenever any app file changes (tools/stamp.py), which is how installed copies pick up an update.
const VERSION = "50bc1ddcd5d0";
const CACHE = 'prep-' + VERSION;
const FILES = ["./", "./index.html", "./styles.css", "./manifest.webmanifest", "./js/app.js", "./js/calc.js", "./js/db.js", "./js/defaults.js", "./js/reader.js", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./fonts/bc-600.woff2", "./fonts/bc-700.woff2"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache =>
    Promise.all(FILES.map(url => fetch(new Request(url, { cache: 'reload' })).then(res => {
      if (!res.ok) throw new Error('Could not fetch ' + url);
      return cache.put(url, res);
    })))));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('prep-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', event => { if (event.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch API calls
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).catch(() => {
    if (req.mode === 'navigate') return caches.match('./index.html');
    return Response.error();
  })));
});
