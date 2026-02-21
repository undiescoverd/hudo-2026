'use client'

import posthog from 'posthog-js'

const CONSENT_KEY = 'hudo_cookie_consent'

export function hasConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(CONSENT_KEY) === 'granted'
}

export function grantConsent(): void {
  localStorage.setItem(CONSENT_KEY, 'granted')
  initPostHog()
}

export function denyConsent(): void {
  localStorage.setItem(CONSENT_KEY, 'denied')
}

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
