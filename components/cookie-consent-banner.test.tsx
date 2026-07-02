/**
 * CookieConsentBanner — source invariants (node:test + fs.readFileSync pattern).
 *
 * Uses Node.js built-in test runner — no DOM runtime needed (repo convention:
 * components are tested via source-pattern invariants, see
 * components/billing/UsageBars.test.tsx / components/comments/CommentInput.test.tsx).
 *
 * S3-COMPLY-003 acceptance criteria covered:
 *  - Banner shows when the `hudo_cookie_consent` localStorage key is absent
 *  - Banner hidden when key is `granted` / `denied`
 *  - Accept writes the key (via grantConsent) and hides the banner
 *  - Reject writes the key (via denyConsent) and hides the banner
 *
 * Run: npx tsx --test "components/cookie-consent-banner.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('CookieConsentBanner — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'cookie-consent-banner.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports a CookieConsentBanner component', () => {
    assert.match(source, /export function CookieConsentBanner/)
  })

  it('delegates consent persistence to lib/posthog (grantConsent/denyConsent), not raw localStorage writes', () => {
    assert.match(
      source,
      /import\s*{\s*grantConsent,\s*denyConsent\s*}\s*from\s*['"]@\/lib\/posthog['"]/
    )
  })

  it('reads the hudo_cookie_consent key on mount to decide initial visibility', () => {
    assert.match(source, /useEffect/)
    assert.match(source, /localStorage\.getItem\(['"]hudo_cookie_consent['"]\)/)
  })

  it('is hidden by default and only becomes visible when no consent key is present', () => {
    // useState(false) is the initial (pre-effect) render value — the banner must not
    // flash visible before the mount-time localStorage check runs.
    assert.match(source, /useState\(false\)/)
    assert.match(source, /if\s*\(!consent\)\s*{\s*setVisible\(true\)/)
  })

  it('renders nothing while not visible (no DOM leaked pre-consent-check or post-decision)', () => {
    assert.match(source, /if\s*\(!visible\)\s*return null/)
  })

  it('accept handler calls grantConsent then hides the banner', () => {
    const match = source.match(/function handleAccept\(\)\s*{([\s\S]*?)}/)
    assert.ok(match, 'expected a handleAccept function')
    const body = match![1]
    assert.match(body, /grantConsent\(\)/)
    assert.match(body, /setVisible\(false\)/)
    // grantConsent must run before the banner is dismissed, not after.
    assert.ok(body.indexOf('grantConsent()') < body.indexOf('setVisible(false)'))
  })

  it('decline handler calls denyConsent then hides the banner', () => {
    const match = source.match(/function handleDecline\(\)\s*{([\s\S]*?)}/)
    assert.ok(match, 'expected a handleDecline function')
    const body = match![1]
    assert.match(body, /denyConsent\(\)/)
    assert.match(body, /setVisible\(false\)/)
    assert.ok(body.indexOf('denyConsent()') < body.indexOf('setVisible(false)'))
  })

  it('never gates or references Supabase auth/session cookies', () => {
    // The consent gate must only ever touch PostHog — auth/session cookies stay active.
    assert.doesNotMatch(source, /supabase|sb-access-token|session/i)
  })
})

describe('CookieConsentBanner — lib/posthog integration (hudo_cookie_consent key)', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, '..', 'lib', 'posthog.ts')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('grantConsent and denyConsent both write the hudo_cookie_consent key the banner reads', () => {
    assert.match(source, /CONSENT_KEY\s*=\s*['"]hudo_cookie_consent['"]/)
    assert.match(source, /localStorage\.setItem\(CONSENT_KEY,\s*['"]granted['"]\)/)
    assert.match(source, /localStorage\.setItem\(CONSENT_KEY,\s*['"]denied['"]\)/)
  })
})
