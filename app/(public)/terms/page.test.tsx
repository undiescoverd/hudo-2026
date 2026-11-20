/**
 * /terms — route, DRAFT marking and footer links.
 *
 * Run: npx tsx --test "app/(public)/terms/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import TermsPage, { metadata } from './page'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '..', '..', '..')

describe('/terms route', () => {
  const html = renderToStaticMarkup(<TermsPage />)

  it('is listed as a public path in middleware.ts', () => {
    const middleware = fs.readFileSync(path.join(repoRoot, 'middleware.ts'), 'utf8')
    assert.match(middleware, /'\/terms'/)
  })

  it('exports page metadata with a title', () => {
    assert.equal(metadata.title, 'Terms of Service — Hudo')
  })

  it('renders the Terms of Service heading', () => {
    assert.match(html, /<h1[^>]*>Terms of Service<\/h1>/)
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

  it('links to the privacy policy and DPA from the body', () => {
    assert.match(html, /href="\/privacy" class="underline/)
    assert.match(html, /href="\/dpa" class="underline/)
  })

  it('keeps unresolved legal points as explicit TBC markers', () => {
    assert.match(html, /\[TBC:/)
  })
})
