/**
 * Unit tests for useSignedUrl logic.
 *
 * Tests pure functions extracted from the hook and verifies source invariants.
 * No DOM or React required.
 *
 * Run: npx tsx --test hooks/useSignedUrl.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// ---------------------------------------------------------------------------
// Test: buildPlaybackUrl — URL shape and security invariant
// ---------------------------------------------------------------------------

describe('buildPlaybackUrl', () => {
  it('returns the API endpoint for a given videoId', async () => {
    const { buildPlaybackUrl } = await import('./useSignedUrl')
    const url = buildPlaybackUrl('abc-123')
    assert.equal(url, '/api/videos/abc-123/playback-url')
  })

  it('appends versionId as a query param when provided', async () => {
    const { buildPlaybackUrl } = await import('./useSignedUrl')
    const url = buildPlaybackUrl('abc-123', 'ver-456')
    assert.equal(url, '/api/videos/abc-123/playback-url?versionId=ver-456')
  })

  it('omits versionId param when null', async () => {
    const { buildPlaybackUrl } = await import('./useSignedUrl')
    const url = buildPlaybackUrl('abc-123', null)
    assert.equal(url, '/api/videos/abc-123/playback-url')
  })

  it('never returns a direct R2 URL', async () => {
    const { buildPlaybackUrl } = await import('./useSignedUrl')
    const url = buildPlaybackUrl('abc-123')
    assert.ok(url.startsWith('/api/'), 'URL must be an API route, not a direct storage URL')
    assert.doesNotMatch(url, /r2\.cloudflarestorage\.com/)
    assert.doesNotMatch(url, /amazonaws\.com/)
  })
})

// ---------------------------------------------------------------------------
// Test: REFRESH_BUFFER_SECONDS — constant value verification
// ---------------------------------------------------------------------------

describe('REFRESH_BUFFER_SECONDS', () => {
  it('is 180 seconds (refresh 3 minutes before expiry = 12-min mark for 15-min URLs)', async () => {
    const { REFRESH_BUFFER_SECONDS } = await import('./useSignedUrl')
    assert.equal(REFRESH_BUFFER_SECONDS, 180)
  })
})

// ---------------------------------------------------------------------------
// Test: Source invariants (via file inspection)
// ---------------------------------------------------------------------------

describe('useSignedUrl source invariants', () => {
  it('schedules refresh at (expiresIn - REFRESH_BUFFER_SECONDS) * 1000 ms', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname ?? __dirname, 'useSignedUrl.ts'),
      'utf8'
    )
    // Verify the timing formula is present
    assert.match(source, /expiresIn - REFRESH_BUFFER_SECONDS/)
    assert.match(source, /\* 1000/)
  })

  it('uses the API endpoint, never a direct R2 URL', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname ?? __dirname, 'useSignedUrl.ts'),
      'utf8'
    )
    assert.match(source, /\/api\/videos\//)
    assert.doesNotMatch(source, /r2\.cloudflarestorage\.com/)
    assert.doesNotMatch(source, /\.r2\.dev/)
  })

  it('uses expiresIn from response for scheduling', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname ?? __dirname, 'useSignedUrl.ts'),
      'utf8'
    )
    // data.expiresIn from the API response drives the timer
    assert.match(source, /data\.expiresIn/)
  })

  it('error state set on fetch failure (never logs raw URL)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname ?? __dirname, 'useSignedUrl.ts'),
      'utf8'
    )
    assert.match(source, /setError/)
    // The catch block must not log the URL itself
    assert.doesNotMatch(source, /console\.log.*url/)
    assert.doesNotMatch(source, /console\.error.*url/)
  })
})
