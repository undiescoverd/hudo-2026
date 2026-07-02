import type { captureRequestError } from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
    })
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    const Sentry = await import('@sentry/nextjs')
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      debug: false,
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
export const onRequestError = async (...args: Parameters<typeof captureRequestError>) => {
  const Sentry = await import('@sentry/nextjs')
  return Sentry.captureRequestError(...args)
}
