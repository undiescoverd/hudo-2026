import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  GuestLink,
  GuestLinkRow as Row,
  isOlderVersion as IsOlder,
  shareCurrentVersion as Share,
} from './GuestLinkList'

// tsx uses the classic JSX runtime, which needs a global React (see GuestShareButton.test).
Object.assign(globalThis, { React })
let GuestLinkRow: typeof Row
let isOlderVersion: typeof IsOlder
let shareCurrentVersion: typeof Share
before(async () => {
  ;({ GuestLinkRow, isOlderVersion, shareCurrentVersion } = await import('./GuestLinkList'))
})

const link = (over: Partial<GuestLink> = {}): GuestLink => ({
  id: 'l1',
  label: 'BBC casting, Sam',
  version_number: 2,
  expires_at: null,
  view_count: 0,
  last_viewed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  ...over,
})

const render = (l: GuestLink, current: number | null) =>
  renderToStaticMarkup(
    React.createElement(GuestLinkRow, {
      link: l,
      currentVersion: current,
      revoking: false,
      sharing: false,
      onRevoke: () => {},
      onShareCurrent: () => {},
    })
  )

describe('GuestLinkRow', () => {
  it('shows the label (escaped) and the pinned version', () => {
    const html = render(link({ label: '<b>x</b>' }), 2)
    assert.match(html, /v2/)
    assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
    assert.doesNotMatch(html, /<b>x/)
  })

  it('shows the older-version nudge only when a newer version exists', () => {
    const older = render(link({ version_number: 2 }), 3)
    assert.match(older, /Shows an older version/)
    assert.match(older, /Share v3 instead/)
    assert.doesNotMatch(render(link({ version_number: 3 }), 3), /older version/)
    assert.doesNotMatch(render(link({ version_number: 2 }), null), /older version/)
    assert.doesNotMatch(render(link({ version_number: null }), 3), /older version/)
  })

  it('isOlderVersion compares pinned against current', () => {
    assert.equal(isOlderVersion(link({ version_number: 1 }), 2), true)
    assert.equal(isOlderVersion(link({ version_number: 2 }), 2), false)
  })
})

describe('shareCurrentVersion ("Share vN instead")', () => {
  it('POSTs a NEW link (carrying the label, 3 day expiry) and never touches the old one', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const fetchStub = (async (url: string, init: RequestInit) => {
      seen.push({ url, init })
      return Response.json({ url: 'https://app.test/guest/tok' }, { status: 201 })
    }) as unknown as typeof fetch
    const url = await shareCurrentVersion('vid-1', 'BBC casting, Sam', fetchStub)
    assert.equal(url, 'https://app.test/guest/tok')
    assert.equal(seen.length, 1)
    assert.equal(seen[0].url, '/api/videos/vid-1/guest-links')
    assert.equal(seen[0].init.method, 'POST')
    const body = JSON.parse(seen[0].init.body as string)
    assert.equal(body.label, 'BBC casting, Sam')
    const lead = new Date(body.expires_at).getTime() - Date.now()
    assert.ok(Math.abs(lead - 3 * 24 * 3600_000) < 60_000)
  })

  it('throws on a failed create', async () => {
    const fetchStub = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
    await assert.rejects(shareCurrentVersion('v', null, fetchStub))
  })
})
