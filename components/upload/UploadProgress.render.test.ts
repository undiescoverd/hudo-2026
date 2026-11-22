/**
 * UploadProgress: rendered error behaviour (S5-FLOW-007).
 *
 * Run: npx tsx --test components/upload/UploadProgress.render.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { UploadProgress } from './UploadProgress'

// tsx compiles JSX with the classic runtime (tsconfig jsx: preserve), so React must be global.
;(globalThis as { React?: unknown }).React = React

function render(error: string | null) {
  return renderToStaticMarkup(
    createElement(UploadProgress, {
      fileName: 'clip.mp4',
      percent: 40,
      isMultipart: true,
      error,
      onRetry: () => {},
    })
  )
}

describe('UploadProgress error display', () => {
  it('shows the real cause and a Retry button for a give-up error', () => {
    const html = render('Part 3 upload failed: 503 (gave up after 3 attempts)')
    assert.match(html, /Part 3 upload failed: 503 \(gave up after 3 attempts\)/)
    assert.match(html, />Retry</)
    assert.doesNotMatch(html, /Storage quota exceeded/)
  })

  it('does not show the quota panel for an unrelated message containing "quota"', () => {
    const html = render('Rate quota for this endpoint was reached, try again later')
    assert.match(html, /Rate quota for this endpoint/)
    assert.match(html, />Retry</)
    assert.doesNotMatch(html, /reached your storage limit/)
  })

  it('shows the quota panel only for the real storage-quota message', () => {
    const html = render('Storage quota exceeded. Please upgrade your plan or delete unused videos.')
    assert.match(html, /reached your storage limit/)
  })
})
