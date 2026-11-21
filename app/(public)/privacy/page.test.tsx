/**
 * /privacy — public legal page. Checks the DRAFT banner, the shared footer
 * links and that every subprocessor is named in the table.
 *
 * Run: npx tsx --test "app/(public)/privacy/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage, { metadata } from './page'

describe('/privacy page', () => {
  const html = renderToStaticMarkup(React.createElement(PrivacyPage))

  it('is titled Privacy Policy', () => {
    assert.equal(metadata.title, 'Privacy Policy — Hudo')
    assert.match(html, /<h1[^>]*>Privacy Policy<\/h1>/)
  })

  it('shows the DRAFT — not yet reviewed banner', () => {
    assert.match(html, /DRAFT — not yet reviewed\./)
  })

  it('renders the shared legal footer with links to all three pages', () => {
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })

  it('names every subprocessor in the subprocessor table', () => {
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
      assert.match(html, new RegExp('<td[^>]*>' + name.replace(/[()]/g, '\\$&') + '</td>'), name)
    }
  })

  it('links to the DPA for processor terms', () => {
    assert.match(html, /href="\/dpa"[^>]*>Data Processing Agreement<\/a>/)
  })

  it('names the controller as Resolve Labs Ltd and brackets the subprocessor terms claim', () => {
    assert.match(html, /Resolve Labs Ltd/)
    assert.match(html, /written agreement \[to be confirmed\]/)
  })
})
