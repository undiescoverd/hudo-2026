/**
 * Unit tests for lib/guest-playback.ts — the first-load vs renewal contract
 * between GuestPlayer and GET /api/guest/:token/playback-url.
 *
 * Run: npx tsx --test lib/guest-playback.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guestPlaybackUrlPath, isGuestPlaybackRenewal } from './guest-playback'

const TOKEN = 'AbC123_-xyz'

/** What the route decides for a path the client built. */
function countsAsView(pathWithQuery: string): boolean {
  const url = new URL(pathWithQuery, 'https://hudo.app')
  return !isGuestPlaybackRenewal(url.searchParams)
}

describe('guestPlaybackUrlPath', () => {
  it('initial load path carries no renew flag', () => {
    assert.equal(guestPlaybackUrlPath(TOKEN, false), `/api/guest/${TOKEN}/playback-url`)
  })

  it('renewal path carries ?renew=1', () => {
    assert.equal(guestPlaybackUrlPath(TOKEN, true), `/api/guest/${TOKEN}/playback-url?renew=1`)
  })
})

describe('isGuestPlaybackRenewal', () => {
  it('true only for renew=1', () => {
    assert.equal(isGuestPlaybackRenewal(new URLSearchParams('renew=1')), true)
  })

  it('false when absent or any other value', () => {
    assert.equal(isGuestPlaybackRenewal(new URLSearchParams('')), false)
    assert.equal(isGuestPlaybackRenewal(new URLSearchParams('renew=0')), false)
    assert.equal(isGuestPlaybackRenewal(new URLSearchParams('renew=true')), false)
    assert.equal(isGuestPlaybackRenewal(new URLSearchParams('renew=')), false)
  })
})

describe('view counting across a watch', () => {
  it('one uninterrupted 2-hour watch (initial load + 10 renewals) counts once', () => {
    // GuestPlayer: fetchUrl(false) on mount, then fetchUrl(true) every ~12 min.
    const requests = [guestPlaybackUrlPath(TOKEN, false)]
    for (let i = 0; i < 10; i++) requests.push(guestPlaybackUrlPath(TOKEN, true))
    assert.equal(requests.filter(countsAsView).length, 1)
  })

  it('a failed renewal retried after 30 s still does not count', () => {
    const requests = [
      guestPlaybackUrlPath(TOKEN, false),
      guestPlaybackUrlPath(TOKEN, true), // fails
      guestPlaybackUrlPath(TOKEN, true), // 30 s retry
    ]
    assert.equal(requests.filter(countsAsView).length, 1)
  })

  it('a page reload counts as a new view (agreed behaviour)', () => {
    const firstLoad = guestPlaybackUrlPath(TOKEN, false)
    const renewal = guestPlaybackUrlPath(TOKEN, true)
    const reload = guestPlaybackUrlPath(TOKEN, false)
    assert.equal([firstLoad, renewal, reload].filter(countsAsView).length, 2)
  })
})

describe('GuestPlayer wiring (source invariant)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const source = fs.readFileSync(path.resolve(dir, '../components/guest/GuestPlayer.tsx'), 'utf8')

  it('builds the fetch URL via guestPlaybackUrlPath, passing isPending as the renewal flag', () => {
    assert.match(source, /fetch\(guestPlaybackUrlPath\(token, isPending\)/)
    assert.doesNotMatch(source, /fetch\(`\/api\/guest\/\$\{token\}\/playback-url`/)
  })

  it('timed renewal and its retry use fetchUrl(true); Retry button uses fetchUrl(false)', () => {
    assert.ok([...source.matchAll(/void fetchUrl\(true\)/g)].length >= 2)
    assert.match(source, /onClick=\{\(\) => fetchUrl\(false\)\}/)
    assert.match(source, /void fetchUrl\(false\)/)
  })
})

describe('guest-playback module hygiene', () => {
  it('has no imports (pure, safe for the use client GuestPlayer)', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    const source = fs.readFileSync(path.resolve(dir, 'guest-playback.ts'), 'utf8')
    assert.doesNotMatch(source, /^import /m)
  })
})
