/* Hudo service worker (S4-PWA-001): app shell + static assets only.
 *
 * Never cached: signed-in HTML, /api, cross-origin requests (incl. signed R2
 * URLs), requests with an Authorization header, non-GET requests. Those are
 * simply not intercepted, so they go straight to the network.
 *
 * `shouldCache` is a hand-kept copy of lib/pwa-cache-rules.ts. A unit test
 * (lib/pwa-cache-rules.test.ts) loads this file and asserts both agree.
 */

// Bump the version suffix whenever the shell (offline page, icons, manifest) changes.
var CACHE_NAME = 'hudo-shell-v1'
var OFFLINE_URL = '/offline'
var PRECACHE = [
  '/offline',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
]

var STATIC_PREFIXES = ['/_next/static/', '/icons/']
var SHELL_PATHS = ['/offline', '/manifest.webmanifest']

function shouldCache(req) {
  if (String(req.method).toUpperCase() !== 'GET') return false
  if (req.hasAuthorization) return false

  var url
  try {
    url = new URL(req.url)
  } catch (e) {
    return false
  }
  if (url.origin !== req.origin) return false

  var pathname = url.pathname
  if (/%2e|%2f|%5c|\\/i.test(pathname)) return false

  if (SHELL_PATHS.indexOf(pathname) !== -1) return url.search === ''
  return STATIC_PREFIXES.some(function (p) {
    return pathname.indexOf(p) === 0 && pathname.length > p.length
  })
}

function toRule(request) {
  return {
    url: request.url,
    method: request.method,
    origin: self.location.origin,
    hasAuthorization: request.headers.has('Authorization'),
  }
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(function (cache) {
        return cache.addAll(PRECACHE)
      })
      .then(function () {
        return self.skipWaiting()
      })
  )
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== CACHE_NAME
            })
            .map(function (k) {
              return caches.delete(k)
            })
        )
      })
      .then(function () {
        return self.clients.claim()
      })
  )
})

function cacheMatch(request) {
  return caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request)
  })
}

// Store only complete, same-origin, non-redirected 200s (no 206 partials, no
// redirects). Never rejects, so a failed put cannot become an unhandled rejection.
function store(request, res) {
  if (!(res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected)) {
    return Promise.resolve()
  }
  var copy = res.clone()
  return caches
    .open(CACHE_NAME)
    .then(function (cache) {
      return cache.put(request, copy)
    })
    .catch(function () {})
}

self.addEventListener('fetch', function (event) {
  var request = event.request

  // Navigations are never cached; offline falls back to the cached /offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(function () {
        return cacheMatch(OFFLINE_URL).then(function (res) {
          return res || Response.error()
        })
      })
    )
    return
  }

  if (!shouldCache(toRule(request))) return // not intercepted: straight to network

  var isShell = SHELL_PATHS.indexOf(new URL(request.url).pathname) !== -1

  event.respondWith(
    cacheMatch(request).then(function (hit) {
      // Static assets: cache-first. Shell pages: stale-while-revalidate.
      if (hit && !isShell) return hit
      var network = fetch(request).then(function (res) {
        event.waitUntil(store(request, res))
        return res
      })
      if (hit) {
        event.waitUntil(network.catch(function () {}))
        return hit
      }
      return network
    })
  )
})
