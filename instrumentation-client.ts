import * as Sentry from '@sentry/nextjs'

// Consent check inlined here because instrumentation context cannot import from lib/posthog.ts.
// Must match CONSENT_KEY in lib/posthog.ts ('hudo_cookie_consent').
// GDPR/PECR: ALL Sentry data (errors + transactions) must be blocked until consent is granted.
function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('hudo_cookie_consent') === 'granted'
}

/**
 * Redact guest tokens from a URL string so they never reach Sentry.
 * Matches any path segment following /api/guest/ before a query string or hash.
 */
function redactGuestUrl(url: string): string {
  return url.replace(/\/api\/guest\/[^/?#]+/, '/api/guest/[redacted]')
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeBreadcrumb(breadcrumb) {
    const url =
      breadcrumb.data && typeof breadcrumb.data.url === 'string' ? breadcrumb.data.url : null
    if (url && url.includes('/api/guest/')) {
      breadcrumb.data = { ...breadcrumb.data, url: redactGuestUrl(url) }
    }
    return breadcrumb
  },
  beforeSend(event) {
    if (!hasConsent()) return null

    // Scrub guest tokens from request URL and referer even if the user previously consented
    if (event.request?.url && event.request.url.includes('/api/guest/')) {
      event.request.url = redactGuestUrl(event.request.url)
    }
    if (
      event.request?.headers &&
      typeof event.request.headers === 'object' &&
      'referer' in event.request.headers &&
      typeof event.request.headers.referer === 'string' &&
      event.request.headers.referer.includes('/api/guest/')
    ) {
      event.request.headers = {
        ...event.request.headers,
        referer: redactGuestUrl(event.request.headers.referer),
      }
    }

    return event
  },
  beforeSendTransaction(event) {
    return hasConsent() ? event : null
  },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
