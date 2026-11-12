// Keeps the app's own files so it opens quickly. Tries the network first so updates show up right away.
// It never touches requests to other sites (like Supabase), so your ideas are always fresh.
const CACHE = 'date-ideas-v7';
const SUPA = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'mascot.js', 'import.js', 'extras.js', 'config.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // The sync library is kept too, so the app can open with no internet. Everything else from other sites is left alone.
  if (url.href === SUPA) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  if (url.origin !== self.location.origin) return; // leave other sites alone
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
