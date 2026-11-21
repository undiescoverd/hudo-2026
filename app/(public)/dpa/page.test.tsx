/**
 * /dpa — public Data Processing Agreement page. Checks the DRAFT banner, the
 * shared footer links and the subprocessor list.
 *
 * Run: npx tsx --test "app/(public)/dpa/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DpaPage, { metadata } from './page'

describe('/dpa page', () => {
  const html = renderToStaticMarkup(React.createElement(DpaPage))

  it('is titled Data Processing Agreement', () => {
    assert.equal(metadata.title, 'Data Processing Agreement — Hudo')
    assert.match(html, /<h1[^>]*>Data Processing Agreement<\/h1>/)
  })

  it('shows the DRAFT — not yet reviewed banner', () => {
    assert.match(html, /DRAFT — not yet reviewed\./)
  })

  it('renders the shared legal footer with links to all three pages', () => {
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })

  it('lists the same subprocessors as the privacy page', () => {
    for (const name of [
      'Supabase',
      'Cloudflare (R2)',
      'Vercel',
      'Stripe',
      'Resend',
      'Upstash',
      'Sentry',
      'PostHog',
    ]) {
      assert.match(html, new RegExp('<li>' + name.replace(/[()]/g, '\\$&') + '</li>'), name)
    }
  })

  it('uses a placeholder for the processor rather than an invented name', () => {
    assert.match(html, /\[Company legal name\]/)
    assert.doesNotMatch(html, /Resolve Labs/)
  })
})
