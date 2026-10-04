// ==============================================================================
// Service worker: caches the whole app so it runs with no network at all.
//
// Cache-first: once installed, the app never waits on the network. A new
// version (bump APP_VERSION in version.js) installs in the background and
// waits. The Home screen offers "Update now" so an update never interrupts a
// match in progress.
//
// If you add a file to the app, add it to ASSETS or it won't work offline.
// ==============================================================================

importScripts('version.js');

const CACHE = `warlocks-scout-${self.APP_VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'version.js',
  'app.js',
  'dom.js',
  'db.js',
  'form.js',
  'qr.js',
  'scanner.js',
  'manifest.webmanifest',
  'vendor/qrcode.js',
  'vendor/jsQR.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  '../shared/fields.js',
  '../shared/codec.js',
  '../shared/schedule.js',
  '../shared/setup-codes.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('warlocks-scout-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(event.request);
    } catch (err) {
      // Offline and not cached: show the app rather than Safari's error page.
      const shell = event.request.mode === 'navigate' && await cache.match('index.html');
      if (shell) return shell;
      throw err;
    }
  })());
});
