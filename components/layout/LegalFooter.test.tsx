/**
 * LegalFooter — links to /terms, /privacy and /dpa.
 *
 * Run: npx tsx --test "components/layout/LegalFooter.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LEGAL_LINKS, LegalFooter } from './LegalFooter'

describe('LegalFooter', () => {
  const html = renderToStaticMarkup(React.createElement(LegalFooter))

  it('lists the three legal pages', () => {
    assert.deepEqual(
      LEGAL_LINKS.map((l) => l.href),
      ['/terms', '/privacy', '/dpa']
    )
  })

  it('renders a link to each legal page inside a labelled nav', () => {
    assert.match(html, /<nav aria-label="Legal"/)
    assert.match(html, /<a[^>]*href="\/terms"[^>]*>Terms of Service<\/a>/)
    assert.match(html, /<a[^>]*href="\/privacy"[^>]*>Privacy Policy<\/a>/)
    assert.match(html, /<a[^>]*href="\/dpa"[^>]*>Data Processing Agreement<\/a>/)
  })
})
