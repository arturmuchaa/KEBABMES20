/* Service worker — offline shell dla pakowania (Kebab MES).
 * Runtime caching (bez precache manifestu): pierwszy load online cache'uje shell,
 * offline serwuje z cache. POST/skan obsługuje apka (kolejka IndexedDB). */
const CACHE = 'kebab-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // POST/skan → apka (kolejka offline)
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNav(req))
  } else if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req))
  } else {
    event.respondWith(cacheFirst(req))
  }
})

// Nawigacja (SPA) → sieć, fallback do zapisanego index.html (boot offline).
async function networkFirstNav(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    cache.put('/', res.clone())
    return res
  } catch {
    return (await cache.match('/')) || new Response('Offline', { status: 503 })
  }
}

// /api GET → sieć, fallback ostatnia znana odpowiedź.
async function networkFirst(req) {
  const cache = await caches.open(CACHE)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    return (await cache.match(req)) || new Response('[]', {
      status: 503, headers: { 'Content-Type': 'application/json' },
    })
  }
}

// Zasoby zahashowane + fonty/ikony → cache-first (immutable).
async function cacheFirst(req) {
  const cache = await caches.open(CACHE)
  const hit = await cache.match(req)
  if (hit) return hit
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    return hit || new Response('', { status: 503 })
  }
}
