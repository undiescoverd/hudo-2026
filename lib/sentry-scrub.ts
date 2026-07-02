/**
 * Server-side Sentry event scrubber (S3-SEC-006).
 *
 * WHY THIS EXISTS: @sentry/node 10.x DEFAULT integrations (httpIntegration +
 * requestDataIntegration) attach the full ambient request context — url,
 * headers, cookies, and up to 10KB of request body — to EVERY event captured
 * during a request, regardless of the arguments passed to captureException.
 * A bare `Sentry.captureException(err)` inside the guest playback route would
 * therefore still ship the plaintext guest token (request.url), the live
 * Supabase session cookie (request.cookies) and POST bodies incl. passwords
 * and invitation tokens (request.data) to Sentry.
 *
 * scrubSentryEvent is wired as `beforeSend` in instrumentation.ts (nodejs +
 * edge inits) and is the SINGLE scrub point for BOTH server error paths:
 * explicit captureException calls today, and the Next 15+ onRequestError →
 * captureRequestError path when the framework upgrade activates it. Every
 * server event passes through here before leaving the process.
 *
 * Secret-in-URL surfaces covered (grep app/ for token-in-path routes before
 * adding new ones):
 * - /api/guest/<token> and /api/guest/<token>/playback-url (path segment)
 * - /guest/<token> page (path segment)
 * - /auth/invite/<token> page (path segment)
 * - /api/invitations/validate?token=... (query param)
 */

type ScrubbableRequest = {
  url?: string
  query_string?: unknown
  cookies?: unknown
  data?: unknown
  headers?: Record<string, unknown>
}

type ScrubbableEvent = {
  request?: ScrubbableRequest
}

/**
 * Headers that can carry bearer secrets. `referer` is included because a
 * request made FROM /guest/<token> or /auth/invite/<token> carries the full
 * token URL in its Referer header.
 */
const SENSITIVE_HEADERS = new Set(['cookie', 'authorization', 'referer'])

/**
 * Path segments following these prefixes are bearer secrets.
 * `/guest/` matches both the /guest/<token> page and /api/guest/<token>[/...]
 * routes (substring match).
 */
const TOKEN_PATH_RE = /(\/guest\/|\/auth\/invite\/)[^/?#]+/g

/** `token` query params, e.g. /api/invitations/validate?token=... */
const TOKEN_QUERY_RE = /([?&]token=)[^&#]*/gi

/** Redacts secret path segments and token query params from a URL string. */
export function redactSecretUrl(url: string): string {
  return url.replace(TOKEN_PATH_RE, '$1[redacted]').replace(TOKEN_QUERY_RE, '$1[redacted]')
}

/**
 * Scrubs a Sentry event in place before it leaves the server:
 * - drops cookies entirely
 * - drops the request body entirely (nothing we capture needs it)
 * - drops the raw query string (may contain ?token=...)
 * - drops cookie/authorization/referer headers (any casing)
 * - redacts secret path segments and token query params in request.url
 *
 * MUST NEVER THROW into Sentry's pipeline. On any unexpected failure it fails
 * safe: strips the request context entirely, or drops the whole event (null)
 * if even that is impossible — losing an event is better than leaking a token.
 */
export function scrubSentryEvent<E extends ScrubbableEvent>(event: E): E | null {
  try {
    const request = event.request
    if (request && typeof request === 'object') {
      delete request.cookies
      delete request.data
      delete request.query_string
      const headers = request.headers
      if (headers && typeof headers === 'object') {
        for (const key of Object.keys(headers)) {
          if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
            delete headers[key]
          }
        }
      }
      if (typeof request.url === 'string') {
        request.url = redactSecretUrl(request.url)
      }
    }
    return event
  } catch {
    try {
      delete event.request
      return event
    } catch {
      return null
    }
  }
}
