import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  MAX_NEEDS_YOU,
  NeedsYouStrip,
  formatAgo,
  selectNeedsYou,
} from '@/components/dashboard/NeedsYouStrip'
import type { AgencyVideoRow } from '@/lib/dashboard'

const row = (i: number, status: AgencyVideoRow['status'] = 'pending_review'): AgencyVideoRow => ({
  id: `v${i}`,
  title: `Video ${i}`,
  status,
  thumbnail_r2_key: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  talent_id: 't1',
  talent_name: 'Anna Bell',
  latest_version: 1,
  comment_count: 0,
  last_activity: `2026-01-0${i}T00:00:00Z`,
})

const render = (videos: AgencyVideoRow[]) =>
  renderToStaticMarkup(createElement(NeedsYouStrip, { videos }))

describe('NeedsYouStrip', () => {
  it('only selects pending_review videos, newest first', () => {
    const out = selectNeedsYou([row(1), row(2, 'approved'), row(3), row(4, 'draft')])
    assert.deepEqual(
      out.map((v) => v.id),
      ['v3', 'v1']
    )
  })

  it('renders nothing when no video needs the agent', () => {
    assert.equal(render([row(1, 'approved'), row(2, 'draft')]), '')
  })

  it('renders every card and no "+N more" when at or under the cap', () => {
    const html = render([row(1), row(2), row(3), row(4)])
    assert.equal(html.match(/data-testid="needs-you-card"/g)?.length, MAX_NEEDS_YOU)
    assert.doesNotMatch(html, /more</)
  })

  it('caps at 4 cards and shows "+N more" for the rest', () => {
    const html = render([1, 2, 3, 4, 5, 6, 7].map((i) => row(i)))
    assert.equal(html.match(/data-testid="needs-you-card"/g)?.length, 4)
    assert.match(html, /\+3 more/)
  })

  it('links cards to the video and uses the fixed status label', () => {
    const html = render([row(1)])
    assert.match(html, /href="\/videos\/v1"/)
    assert.match(html, /Pending review/)
  })

  it('formats relative time', () => {
    const now = new Date('2026-01-10T12:00:00Z')
    assert.equal(formatAgo('2026-01-10T11:35:00Z', now), '25m ago')
    assert.equal(formatAgo('2026-01-10T09:00:00Z', now), '3h ago')
    assert.equal(formatAgo('2026-01-08T12:00:00Z', now), '2d ago')
  })
})
