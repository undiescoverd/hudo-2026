/**
 * /dpa — route, DRAFT marking, sub-processor schedule and footer links.
 *
 * Run: npx tsx --test "app/(public)/dpa/page.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import DpaPage, { metadata } from './page'

const dir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(dir, '..', '..', '..')

const EXPECTED_SUB_PROCESSORS = [
  'Supabase',
  'Cloudflare',
  'Vercel',
  'Stripe',
  'Resend',
  'Upstash',
  'Sentry',
  'PostHog',
]

describe('/dpa route', () => {
  const html = renderToStaticMarkup(<DpaPage />)

  it('is listed as a public path in middleware.ts', () => {
    const middleware = fs.readFileSync(path.join(repoRoot, 'middleware.ts'), 'utf8')
    assert.match(middleware, /'\/dpa'/)
  })

  it('exports page metadata with a title', () => {
    assert.equal(metadata.title, 'Data Processing Agreement — Hudo')
  })

  it('renders the Data Processing Agreement heading', () => {
    assert.match(html, /<h1[^>]*>Data Processing Agreement<\/h1>/)
  })

  it('is clearly marked DRAFT pending approval', () => {
    assert.match(html, /DRAFT — pending approval\. Not yet in force\./)
  })

  it('keeps the nine clauses mirrored from DpaAcceptanceModal', () => {
    for (let n = 1; n <= 9; n++) {
      assert.match(html, new RegExp(`${n}\\. [A-Z]`))
    }
  })

  it('lists every sub-processor in the schedule', () => {
    for (const name of EXPECTED_SUB_PROCESSORS) {
      assert.match(html, new RegExp(`<td class="py-2 pr-4">${name}</td>`))
    }
  })

  it('marks sub-processor locations as TBC rather than asserting them', () => {
    const tbc = html.match(/\[TBC\]/g) ?? []
    assert.equal(tbc.length, EXPECTED_SUB_PROCESSORS.length)
  })

  it('renders the shared legal footer with links to /terms, /privacy and /dpa', () => {
    assert.match(html, /<nav aria-label="Legal"/)
    assert.match(html, /href="\/terms"/)
    assert.match(html, /href="\/privacy"/)
    assert.match(html, /href="\/dpa"/)
  })
})
