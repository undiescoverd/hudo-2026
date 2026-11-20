/* Hudo service worker: app shell + static assets only.
 * Mirrors lib/pwa-cache-rules.ts (SHELL_URLS, STATIC_PREFIXES, denials); a unit
 * test asserts the constants below stay in sync. Never cache authenticated HTML,
 * /api responses, or signed R2 URLs. */
const CACHE = 'hudo-shell-v1'
const SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]
const STATIC_PREFIXES = ['/_next/static/', '/icons/']

function isCacheable(request) {
  if (request.method.toUpperCase() !== 'GET') return false
  const u = new URL(request.url)
  if (u.origin !== self.location.origin) return false
  if (u.hostname.endsWith('cloudflarestorage.com')) return false
  if (u.pathname.startsWith('/api/')) return false
  if (/x-amz-signature/i.test(u.search)) return false
  if (SHELL_URLS.includes(u.pathname)) return true
  return STATIC_PREFIXES.some((p) => u.pathname.startsWith(p))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Navigations always hit the network (never cached); offline falls back to /offline.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline')))
    return
  }
  if (!isCacheable(request)) return // let the browser handle it, uncached
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
    )
  )
})
