/**
 * StatusPill — fixed labels and v3 status tokens.
 *
 * Run: npx tsx --test "components/ui/status-pill.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { STATUS_PILL_STATUSES, StatusPill } from './status-pill'
import { StatusBadge } from '@/lib/video-status'

const EXPECTED = {
  draft: ['Draft', 'draft'],
  pending_review: ['Pending review', 'pending'],
  in_review: ['In review', 'review'],
  changes_requested: ['Changes requested', 'changes'],
  approved: ['Approved', 'approved'],
} as const

describe('StatusPill', () => {
  for (const status of STATUS_PILL_STATUSES) {
    it(`renders ${status} with its fixed label and status tokens`, () => {
      const [label, token] = EXPECTED[status]
      const html = renderToStaticMarkup(React.createElement(StatusPill, { status }))
      assert.match(html, new RegExp(`>${label}</span>`))
      assert.match(html, new RegExp(`bg-status-${token}-bg`))
      assert.match(html, new RegExp(`text-status-${token}-fg`))
    })
  }

  it('StatusBadge renders through StatusPill and falls back to Draft', () => {
    const approved = renderToStaticMarkup(React.createElement(StatusBadge, { status: 'approved' }))
    const unknown = renderToStaticMarkup(React.createElement(StatusBadge, { status: 'nope' }))
    assert.match(approved, />Approved</)
    assert.match(unknown, />Draft</)
  })
})
