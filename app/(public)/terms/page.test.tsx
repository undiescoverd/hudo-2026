/**
 * /terms — public legal page. Renders the server markup and checks the DRAFT
 * banner, the shared footer links and the metadata title.
 *
 * Run: npx tsx --test "app/(public)/terms/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TermsPage, { metadata } from './page'

describe('/terms page', () => {
  const html = renderToStaticMarkup(React.createElement(TermsPage))

  it('is titled Terms of Service', () => {
    assert.equal(metadata.title, 'Terms of Service — Hudo')
    assert.match(html, /<h1[^>]*>Terms of Service<\/h1>/)
  })

  it('shows the DRAFT — not yet reviewed banner', () => {
    assert.match(html, /DRAFT — not yet reviewed\./)
    assert.match(html, /role="status"/)
  })

  it('renders the shared legal footer with links to all three pages', () => {
    assert.match(html, /aria-label="Legal"/)
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })

  it('names the operator as Resolve Labs Ltd and keeps other details as placeholders', () => {
    assert.match(html, /operated by Resolve Labs Ltd/)
    assert.match(html, /\[Company registration number\]/)
  })

  it('brackets the VAT treatment instead of asserting it', () => {
    assert.match(html, /\[VAT treatment to be confirmed\.\]/)
    assert.doesNotMatch(html, /exclusive of VAT/)
  })
})
