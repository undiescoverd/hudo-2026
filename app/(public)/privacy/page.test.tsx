/**
 * /privacy — route, DRAFT marking and footer links.
 *
 * Run: npx tsx --test "app/(public)/privacy/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import PrivacyPage, { metadata } from './page'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '..', '..', '..')

describe('/privacy route', () => {
  const html = renderToStaticMarkup(<PrivacyPage />)

  it('is listed as a public path in middleware.ts', () => {
    const middleware = fs.readFileSync(path.join(repoRoot, 'middleware.ts'), 'utf8')
    assert.match(middleware, /'\/privacy'/)
  })

  it('exports page metadata with a title', () => {
    assert.equal(metadata.title, 'Privacy Policy — Hudo')
  })

  it('renders the Privacy Policy heading', () => {
    assert.match(html, /<h1[^>]*>Privacy Policy<\/h1>/)
  })

  it('is clearly marked DRAFT pending approval', () => {
    assert.match(html, /DRAFT — pending approval\. Not yet in force\./)
  })

  it('renders the shared legal footer with links to /terms, /privacy and /dpa', () => {
    assert.match(html, /<nav aria-label="Legal"/)
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })

  it('describes the cookie consent gate for analytics', () => {
    assert.match(html, /Product analytics, only if you accept analytics cookies/)
  })
})
