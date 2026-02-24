import * as Sentry from '@sentry/nextjs'

// Consent check inlined here because instrumentation context cannot import from lib/posthog.ts.
// Must match CONSENT_KEY in lib/posthog.ts ('hudo_cookie_consent').
// GDPR/PECR: ALL Sentry data (errors + transactions) must be blocked until consent is granted.
function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem('hudo_cookie_consent') === 'granted'
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  debug: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  beforeSend(event) {
    return hasConsent() ? event : null
  },
  beforeSendTransaction(event) {
    return hasConsent() ? event : null
  },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
