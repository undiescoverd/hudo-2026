/**
 * Allow/deny rules for the service worker cache (S4-PWA-001).
 *
 * The service worker may cache ONLY the app shell and static assets. Anything
 * that could carry user data (signed-in HTML, /api, signed R2 URLs, auth'd
 * requests) must never reach Cache Storage.
 *
 * `public/sw.js` is plain JS and cannot import this file, so it carries a copy
 * of `shouldCache`. `lib/pwa-cache-rules.test.ts` loads sw.js in a vm and
 * asserts both implementations agree on every case. Change both together.
 */

export interface CacheRequest {
  /** Absolute request URL. */
  url: string
  method: string
  /** The service worker's own origin (self.location.origin). */
  origin: string
  /** True when the request carries an Authorization header. */
  hasAuthorization?: boolean
}

/** Same-origin path prefixes of static assets (query strings allowed). */
const STATIC_PREFIXES = ['/_next/static/', '/icons/']

/** Exact same-origin paths in the shell (no query string allowed). */
const SHELL_PATHS = ['/offline', '/manifest.webmanifest']

export function shouldCache(req: CacheRequest): boolean {
  if (String(req.method).toUpperCase() !== 'GET') return false
  if (req.hasAuthorization) return false

  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return false
  }
  if (url.origin !== req.origin) return false

  const { pathname, search } = url
  // Encoded dots/slashes/backslashes can be decoded server-side into traversal.
  if (/%2e|%2f|%5c|\\/i.test(pathname)) return false

  if (SHELL_PATHS.includes(pathname)) return search === ''
  return STATIC_PREFIXES.some((p) => pathname.startsWith(p) && pathname.length > p.length)
}
