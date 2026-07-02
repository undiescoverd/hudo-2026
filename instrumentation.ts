import type { captureRequestError } from '@sentry/nextjs'
import { scrubSentryEvent } from '@/lib/sentry-scrub'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
      // SECURITY (S3-SEC-006): @sentry/node 10.x default integrations attach
      // the full ambient request context (url, headers, cookies, up to 10KB of
      // body) to EVERY event captured during a request — regardless of
      // captureException's arguments. Without this scrub, any server-side
      // capture would leak plaintext guest tokens (request.url), Supabase
      // session cookies (request.cookies) and POST bodies incl. passwords
      // (request.data). beforeSend is the SINGLE scrub point for both explicit
      // captureException calls and the (future, Next 15+) onRequestError path
      // below. See lib/sentry-scrub.ts.
      beforeSend: scrubSentryEvent,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
      // Same scrub as the nodejs runtime above — see lib/sentry-scrub.ts.
      beforeSend: scrubSentryEvent,
    })
  }
}

// Reports uncaught errors thrown from route handlers, server components, and
// middleware to Sentry, via the Next.js `onRequestError` instrumentation hook.
//
// NOTE (Next 14 caveat): `onRequestError` is only invoked by Next.js 15+.
// This repo is pinned to Next 14.2.x (see package.json), where the App
// Router never calls this hook — Next 14's server has no reference to
// `onRequestError` anywhere in its build output. This export is therefore
// currently INERT: it is harmless dead code today, kept only so that an
// eventual Next 15 upgrade gets automatic route-error reporting with zero
// further changes. Until that upgrade, uncaught route-handler errors do
// NOT reach Sentry via this path — the explicit `Sentry.captureException`
// calls added to the known swallowed-failure paths (lib/audit.ts,
// guest playback-url, comment notification enqueue, invitation accept)
// are the operative fix for this repo today.
//
// PII: events produced by this hook flow through the same `beforeSend` scrub
// configured in register() above (lib/sentry-scrub.ts) — the single scrub
// point for both capture paths — so when Next 15 activates it, request
// cookies/bodies are dropped and token-bearing URLs are redacted here too.
export const onRequestError = async (...args: Parameters<typeof captureRequestError>) => {
  const Sentry = await import('@sentry/nextjs')
  return Sentry.captureRequestError(...args)
}
