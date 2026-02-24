'use client'

import posthog from 'posthog-js'

const CONSENT_KEY = 'hudo_cookie_consent'

/** Returns true if the user has granted cookie consent. */
export function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(CONSENT_KEY) === 'granted'
}

/** Records that the user has granted cookie consent in localStorage. */
export function grantConsent(): void {
  localStorage.setItem(CONSENT_KEY, 'granted')
  initPostHog()
}

/** Records that the user has denied cookie consent in localStorage. */
export function denyConsent(): void {
  localStorage.setItem(CONSENT_KEY, 'denied')
}

/** Initialises PostHog analytics. Must only be called after consent is granted. */
export function initPostHog(): void {
  if (typeof window === 'undefined') return
  if (!hasConsent()) return

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST

  if (!key || !host) return

  posthog.init(key, {
    api_host: host,
    capture_pageview: true,
    persistence: 'localStorage+cookie',
    loaded: (ph) => {
      if (process.env.NODE_ENV === 'development') {
        ph.debug()
      }
    },
  })
}

export { posthog }
