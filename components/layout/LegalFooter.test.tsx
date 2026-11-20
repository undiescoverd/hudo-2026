/**
 * LegalFooter — SSR render test plus link-target checks.
 *
 * Run: npx tsx --test "components/layout/LegalFooter.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LegalFooter, LEGAL_LINKS } from './LegalFooter'

describe('LegalFooter', () => {
  const html = renderToStaticMarkup(<LegalFooter />)

  it('renders a footer with a labelled Legal navigation landmark', () => {
    assert.match(html, /<footer/)
    assert.match(html, /<nav aria-label="Legal"/)
  })

  it('links to /terms, /privacy and /dpa', () => {
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })

  it('exposes exactly the three legal routes in LEGAL_LINKS', () => {
    assert.deepEqual(
      LEGAL_LINKS.map((l) => l.href),
      ['/terms', '/privacy', '/dpa']
    )
  })

  it('renders every LEGAL_LINKS label as link text', () => {
    for (const link of LEGAL_LINKS) {
      assert.match(html, new RegExp(`>${link.label}</a>`))
    }
  })
})
