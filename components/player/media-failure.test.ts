/**
 * Media-error state transitions: error → retry → late onError from the old url →
 * new url → error clears (S5-ERR-001 review).
 *
 * Run: pnpm exec tsx components/player/media-failure.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMediaFailed } from './media-failure'

describe('isMediaFailed', () => {
  it('error → retry → late old-url error → new url clears the error', () => {
    let url: string | null = 'https://r2/old?sig=1'
    let failed: string | null = null

    // the old url fails (file missing)
    failed = url
    assert.equal(isMediaFailed(failed, url), true)

    // Retry fetches a fresh url; it must NOT clear the error or touch the stuck url
    assert.equal(isMediaFailed(failed, url), true)

    // a late error event from the old url (still mounted on it) changes nothing
    failed = url
    assert.equal(isMediaFailed(failed, url), true)

    // the new signed url lands: error clears without any extra click
    url = 'https://r2/new?sig=2'
    assert.equal(isMediaFailed(failed, url), false)

    // and if the new url also fails, it shows again
    failed = url
    assert.equal(isMediaFailed(failed, url), true)
  })

  it('a stale error for an earlier url never marks the current url failed', () => {
    assert.equal(isMediaFailed('https://r2/old', 'https://r2/new'), false)
    assert.equal(isMediaFailed(null, 'https://r2/new'), false)
    assert.equal(isMediaFailed(null, null), false)
  })
})
