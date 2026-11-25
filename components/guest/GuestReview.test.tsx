/**
 * GuestReview renders the player only: no comments section (S5-GUEST-001).
 *
 * Run: pnpm exec tsx components/guest/GuestReview.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GuestReview as GuestReviewType } from './GuestReview'

describe('GuestReview', () => {
  let GuestReview: typeof GuestReviewType

  before(async () => {
    // tsx compiles JSX to React.createElement; the app's own build injects it.
    ;(globalThis as { React?: unknown }).React = React
    ;({ GuestReview } = await import('./GuestReview'))
  })

  it('renders the player stage with no comments section', () => {
    const html = renderToStaticMarkup(React.createElement(GuestReview, { token: 'tok' }))
    assert.ok(html.length > 0)
    assert.doesNotMatch(html, /comment/i)
  })
})
