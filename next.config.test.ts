/**
 * Regression guard for the Content-Security-Policy directives in next.config.js.
 *
 * Why this exists: playback was dead on staging because `media-src` omitted the
 * Cloudflare R2 host while `connect-src` allowed it — so upload PUTs worked but
 * the <video> loading a signed R2 URL was blocked. The fully-mocked unit suite
 * never asserts CSP contents, so the regression was invisible. These assertions
 * fail loudly if a future edit drops the R2 host from either directive.
 *
 * Run: npx tsx --test next.config.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { CSP_DIRECTIVES } = require('./next.config.js') as {
  CSP_DIRECTIVES: string[]
}

const R2_HOST = 'https://*.r2.cloudflarestorage.com'

function directive(name: string): string {
  const found = CSP_DIRECTIVES.find((d) => d.startsWith(`${name} `))
  assert.ok(found, `CSP is missing a "${name}" directive entirely`)
  return found
}

describe('next.config.js CSP directives', () => {
  it('exposes CSP_DIRECTIVES as a non-empty array', () => {
    assert.ok(Array.isArray(CSP_DIRECTIVES) && CSP_DIRECTIVES.length > 0)
  })

  it('allowlists the R2 host in media-src (signed-URL playback)', () => {
    assert.ok(
      directive('media-src').includes(R2_HOST),
      `media-src must include ${R2_HOST} or signed R2 <video> playback is CSP-blocked`
    )
  })

  it('allowlists the R2 host in connect-src (paired invariant for upload PUTs)', () => {
    assert.ok(
      directive('connect-src').includes(R2_HOST),
      `connect-src must include ${R2_HOST} or R2 upload PUTs are CSP-blocked`
    )
  })

  it("keeps 'self' and blob: in media-src", () => {
    const mediaSrc = directive('media-src')
    assert.ok(mediaSrc.includes("'self'"))
    assert.ok(mediaSrc.includes('blob:'))
  })
})
