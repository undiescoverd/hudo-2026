/**
 * lib/posthog — consent-gate unit tests.
 *
 * This module is a 'use client' file that checks `typeof window` before
 * touching `localStorage` or `posthog.init`. To exercise it under Node's
 * test runner we install minimal `window`/`localStorage` globals (repo
 * precedent: globalThis.fetch is reassigned/restored the same way in
 * app/api/webhooks/stripe/route.test.ts and lib/api-helpers.test.ts) and
 * stub the real `posthog.init` with node:test's built-in `mock.method` so
 * no network/browser-only calls happen and no new test dependency is added.
 *
 * S3-COMPLY-003 acceptance criteria covered:
 *  - PostHog script must not load (posthog.init not called) before consent
 *  - grantConsent writes "granted" to hudo_cookie_consent and inits PostHog
 *  - denyConsent writes "denied" to hudo_cookie_consent and does NOT init
 *
 * Run: npx tsx --test "lib/posthog.test.ts"
 */

import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test'
import type * as PosthogModule from './posthog.js'

const CONSENT_KEY = 'hudo_cookie_consent'

function createFakeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string): void {
      store.set(key, value)
    },
    removeItem(key: string): void {
      store.delete(key)
    },
    clear(): void {
      store.clear()
    },
  }
}

describe('lib/posthog — consent gate', () => {
  const originalWindow = (globalThis as Record<string, unknown>).window
  const originalLocalStorage = (globalThis as Record<string, unknown>).localStorage
  const originalKey = process.env.NEXT_PUBLIC_POSTHOG_KEY
  const originalHost = process.env.NEXT_PUBLIC_POSTHOG_HOST

  let posthogMod: typeof PosthogModule
  let fakeLocalStorage: ReturnType<typeof createFakeLocalStorage>

  before(async () => {
    // Simulate a browser environment so the module's `typeof window` guards
    // pass, matching the real client-side call path.
    ;(globalThis as Record<string, unknown>).window = {}
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key'
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://app.posthog.test'

    posthogMod = await import('./posthog.js')
  })

  after(() => {
    if (originalWindow === undefined) {
      delete (globalThis as Record<string, unknown>).window
    } else {
      ;(globalThis as Record<string, unknown>).window = originalWindow
    }
    if (originalLocalStorage === undefined) {
      delete (globalThis as Record<string, unknown>).localStorage
    } else {
      ;(globalThis as Record<string, unknown>).localStorage = originalLocalStorage
    }
    if (originalKey === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_KEY
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_KEY = originalKey
    }
    if (originalHost === undefined) {
      delete process.env.NEXT_PUBLIC_POSTHOG_HOST
    } else {
      process.env.NEXT_PUBLIC_POSTHOG_HOST = originalHost
    }
  })

  beforeEach(() => {
    fakeLocalStorage = createFakeLocalStorage()
    ;(globalThis as Record<string, unknown>).localStorage = fakeLocalStorage
  })

  afterEach(() => {
    mock.restoreAll()
  })

  it('initPostHog() no-ops without consent — posthog.init is NOT called', () => {
    const initMock = mock.method(posthogMod.posthog, 'init', () => {})

    posthogMod.initPostHog()

    assert.equal(initMock.mock.calls.length, 0)
    assert.equal(posthogMod.hasConsent(), false)
  })

  it('grantConsent() writes "granted" under hudo_cookie_consent and inits PostHog', () => {
    const initMock = mock.method(posthogMod.posthog, 'init', () => {})

    posthogMod.grantConsent()

    assert.equal(fakeLocalStorage.getItem(CONSENT_KEY), 'granted')
    assert.equal(posthogMod.hasConsent(), true)
    assert.equal(initMock.mock.calls.length, 1)

    const [key, options] = initMock.mock.calls[0].arguments as [string, Record<string, unknown>]
    assert.equal(key, 'phc_test_key')
    assert.equal(options.api_host, 'https://app.posthog.test')
  })

  it('denyConsent() writes "denied" under hudo_cookie_consent and does NOT init PostHog', () => {
    const initMock = mock.method(posthogMod.posthog, 'init', () => {})

    posthogMod.denyConsent()

    assert.equal(fakeLocalStorage.getItem(CONSENT_KEY), 'denied')
    assert.equal(posthogMod.hasConsent(), false)
    assert.equal(initMock.mock.calls.length, 0)
  })

  it('initPostHog() is a no-op when the consent key is "denied"', () => {
    const initMock = mock.method(posthogMod.posthog, 'init', () => {})

    posthogMod.denyConsent()
    posthogMod.initPostHog()

    assert.equal(initMock.mock.calls.length, 0)
  })

  it('initPostHog() inits PostHog once consent has already been granted', () => {
    const initMock = mock.method(posthogMod.posthog, 'init', () => {})

    fakeLocalStorage.setItem(CONSENT_KEY, 'granted')
    posthogMod.initPostHog()

    assert.equal(initMock.mock.calls.length, 1)
  })
})

describe('lib/posthog — server/SSR safety (no window)', () => {
  const originalWindow = (globalThis as Record<string, unknown>).window

  before(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  after(() => {
    if (originalWindow !== undefined) {
      ;(globalThis as Record<string, unknown>).window = originalWindow
    }
  })

  it('hasConsent() returns false when window is undefined (SSR)', async () => {
    const { hasConsent } = await import('./posthog.js')
    assert.equal(hasConsent(), false)
  })

  it('initPostHog() does not throw when window is undefined (SSR)', async () => {
    const { initPostHog } = await import('./posthog.js')
    assert.doesNotThrow(() => initPostHog())
  })
})
