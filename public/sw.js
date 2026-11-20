/* Hudo service worker: app shell + static assets only.
 * Mirrors lib/pwa-cache-rules.ts (constants, isCacheable); unit tests assert the
 * constants match and evaluate isCacheable below against the same case table.
 * Never cache authenticated HTML, /api responses, or signed R2 URLs. The only
 * HTML ever written to the cache is the exact URL /offline. */
const CACHE_PREFIX = 'hudo-shell-'
// Bump when the shell changes (offline page, icons, manifest).
const CACHE_VERSION = 'v1'
const CACHE = CACHE_PREFIX + CACHE_VERSION
const MAX_STATIC_ENTRIES = 60
const SHELL_URLS = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]
const STATIC_PREFIXES = ['/_next/static/', '/icons/']
const OFFLINE_REFRESH_MS = 10 * 60 * 1000
let lastOfflineRefresh = 0

function isCacheable(request) {
  if (request.method.toUpperCase() !== 'GET') return false
  const u = new URL(request.url)
  if (u.origin !== self.location.origin) return false
  if (u.hostname.endsWith('cloudflarestorage.com')) return false
  if (u.search) return false
  if (u.pathname.startsWith('/api/')) return false
  if (/x-amz-signature/i.test(u.search)) return false
  if (SHELL_URLS.includes(u.pathname)) return true
  return STATIC_PREFIXES.some((p) => u.pathname.startsWith(p))
}

function isStorable(res) {
  return res.ok && !res.redirected && res.type === 'basic'
}

// Re-fetch /offline from the network (bypassing HTTP cache) so it references
// current hashed chunks. Writes only the exact URL /offline.
function refreshOffline() {
  lastOfflineRefresh = Date.now()
  return fetch('/offline', { cache: 'reload' })
    .then((res) =>
      isStorable(res) ? caches.open(CACHE).then((c) => c.put('/offline', res)) : null
    )
    .catch(() => {})
}

function trimStatic(cache) {
  return cache.keys().then((keys) => {
    const statics = keys.filter((k) => new URL(k.url).pathname.startsWith('/_next/static/'))
    return Promise.all(
      statics.slice(0, Math.max(0, statics.length - MAX_STATIC_ENTRIES)).map((k) => cache.delete(k))
    )
  })
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
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(refreshOffline)
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  // Navigations always hit the network (never cached); offline falls back to /offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(
        (res) => {
          if (Date.now() - lastOfflineRefresh > OFFLINE_REFRESH_MS)
            event.waitUntil(refreshOffline())
          return res
        },
        () => caches.match('/offline')
      )
    )
    return
  }
  if (!isCacheable(request)) return // let the browser handle it, uncached
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          if (isStorable(res)) {
            const copy = res.clone()
            event.waitUntil(
              caches.open(CACHE).then((c) => c.put(request, copy).then(() => trimStatic(c)))
            )
          }
          return res
        })
    )
  )
})
