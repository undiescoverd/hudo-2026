import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TalentDashboard } from '@/components/dashboard/TalentDashboard'
import type { TalentVideo } from '@/lib/talent-dashboard'

const video = (i: number, over: Partial<TalentVideo> = {}): TalentVideo => ({
  id: `v${i}`,
  title: `Video ${i}`,
  status: 'in_review',
  thumbnail_r2_key: null,
  created_at: '2026-01-01T00:00:00Z',
  latest_version: 1,
  unread_count: 0,
  ...over,
})

const render = (videos: TalentVideo[]) =>
  renderToStaticMarkup(createElement(TalentDashboard, { videos }))

describe('TalentDashboard — agency label', () => {
  it('renders the agency name on each row for talent in more than one agency', () => {
    const html = render([
      video(1, { agency_name: 'Agency A' }),
      video(2, { agency_name: 'Agency B' }),
    ])

    assert.equal(html.match(/data-testid="tracker-row"/g)?.length, 2)
    assert.ok(html.includes('Agency A'))
    assert.ok(html.includes('Agency B'))
  })

  it('renders no agency label for talent in a single agency', () => {
    const html = render([video(1, { agency_name: null }), video(2)])

    assert.equal(html.match(/data-testid="tracker-row"/g)?.length, 2)
    assert.ok(!html.includes('Agency A'))
    assert.ok(!html.includes('Agency B'))
  })

  it('adds no agency picker or filter control', () => {
    const html = render([
      video(1, { agency_name: 'Agency A' }),
      video(2, { agency_name: 'Agency B' }),
    ])

    assert.doesNotMatch(html, /<select/)
    assert.doesNotMatch(html, /<input/)
    assert.doesNotMatch(html, /role="combobox"/)
    assert.doesNotMatch(html, /role="listbox"/)
  })
})
