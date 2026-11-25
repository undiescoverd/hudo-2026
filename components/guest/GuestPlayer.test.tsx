/**
 * Guest player load failures: 429 vs everything else, and Retry re-requests (S5-ERR-001).
 *
 * Run: pnpm exec tsx components/guest/GuestPlayer.test.tsx
 */
import assert from 'node:assert/strict'
import { afterEach, before, describe, it } from 'node:test'
import React from 'react'
import { expand, findAll, textOf } from '../player/tree.testutil'

import type * as GuestPlayerMod from './GuestPlayer'
type Mod = typeof GuestPlayerMod
const realFetch = globalThis.fetch
let calls: string[] = []

function stubFetch(status: number, body: unknown = {}) {
  calls = []
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response(JSON.stringify(body), { status })
  }) as typeof fetch
}

describe('GuestPlayer load errors', () => {
  let m: Mod
  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    m = await import('./GuestPlayer')
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('a 429 response is classified as rate-limited', async () => {
    stubFetch(429, { error: 'Too many requests' })
    await assert.rejects(m.requestGuestPlaybackUrl('tok', false), (e: unknown) => {
      assert.ok(e instanceof m.GuestPlaybackError)
      assert.equal(e.kind, 'rate-limited')
      return true
    })
  })

  it('500, 404 and 403 responses are classified as failed', async () => {
    for (const status of [500, 404, 403]) {
      stubFetch(status)
      await assert.rejects(m.requestGuestPlaybackUrl('tok', false), (e: unknown) => {
        assert.ok(e instanceof m.GuestPlaybackError)
        assert.equal(e.kind, 'failed', String(status))
        return true
      })
    }
  })

  it('renewals send renew=1 and initial loads / retries do not', async () => {
    stubFetch(200, { url: 'https://signed.example/v.mp4', expires_in: 900 })
    await m.requestGuestPlaybackUrl('tok', true)
    await m.requestGuestPlaybackUrl('tok', false)
    assert.match(calls[0], /renew=1/)
    assert.doesNotMatch(calls[1], /renew=1/)
  })

  it('a 200 response returns the signed url', async () => {
    stubFetch(200, { url: 'https://signed.example/v.mp4', expires_in: 900 })
    const data = await m.requestGuestPlaybackUrl('tok', false)
    assert.equal(data.url, 'https://signed.example/v.mp4')
  })

  it('rate-limited shows "Give it a minute" with Retry; failed shows the load message', () => {
    const rl = expand(
      React.createElement(m.GuestPlayerError, { kind: 'rate-limited', onRetry() {} })
    )
    assert.match(textOf(rl), /Give it a minute and try again\./)
    assert.doesNotMatch(textOf(rl), /couldn't be loaded/)
    assert.equal(findAll(rl, (e) => e.type === 'button').length, 1)

    const failed = expand(React.createElement(m.GuestPlayerError, { kind: 'failed', onRetry() {} }))
    assert.match(textOf(failed), /This video couldn't be loaded/)
    assert.doesNotMatch(textOf(failed), /Give it a minute/)
    assert.doesNotMatch(textOf(failed), /\bnotes?\b/i)
  })

  it('Retry runs the retry handler, which re-requests the playback url', async () => {
    stubFetch(200, { url: 'https://signed.example/v.mp4', expires_in: 900 })
    const onRetry = () => void m.requestGuestPlaybackUrl('tok', false)
    const tree = expand(React.createElement(m.GuestPlayerError, { kind: 'rate-limited', onRetry }))
    const [btn] = findAll(tree, (e) => e.type === 'button')
    assert.equal(textOf(btn), 'Retry')
    assert.equal(calls.length, 0)
    ;(btn.props.onClick as () => void)()
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(calls.length, 1)
    assert.match(calls[0], /\/api\/guest\/tok\/playback-url/)
    assert.doesNotMatch(calls[0], /renew=1/) // a retry counts as a real load, not a renewal
  })
})
