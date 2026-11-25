/**
 * /guest/invalid renders generic per-reason copy and never echoes the query (GH #171).
 *
 * Run: pnpm exec tsx app/guest/invalid/page.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type PageType from './page'
type Page = typeof PageType

describe('/guest/invalid', () => {
  let Page: Page
  before(async () => {
    ;(globalThis as { React?: unknown }).React = React
    Page = (await import('./page')).default
  })
  const render = (reason?: string | string[]) =>
    renderToStaticMarkup(React.createElement(Page, { searchParams: { reason } }))

  const cases: [string, string, string][] = [
    ['expired', 'This link has expired', 'Ask the person who shared it for a new one.'],
    ['revoked', 'This link is no longer available', 'Ask them for a new link.'],
    ['subscription', 'isn&#x27;t available right now', 'check with their team'],
    ['not-found', 'We can&#x27;t find that link', 'Check the address'],
  ]
  for (const [reason, heading, body] of cases) {
    it(`reason=${reason} gets its own heading and body`, () => {
      const html = render(reason)
      assert.ok(html.includes(heading), `missing heading: ${heading}`)
      assert.ok(html.includes(body), `missing body: ${body}`)
    })
  }

  it('each reason shows a different heading', () => {
    const headings = new Set(cases.map(([r]) => /<h1[^>]*>(.*?)<\/h1>/.exec(render(r))?.[1]))
    assert.equal(headings.size, 4)
  })

  it('unknown, missing and array reasons fall back to not-found copy', () => {
    for (const r of [undefined, 'bogus', '__proto__', 'constructor', ['expired', 'x']]) {
      assert.ok(render(r).includes('We can&#x27;t find that link'), String(r))
    }
  })

  it('never echoes query text into the page', () => {
    const html = render('<script>alert(1)</script>')
    assert.ok(!html.includes('alert(1)'))
    assert.ok(!html.includes('script'))
  })

  it('shows no names, dates or billing details and never says "notes"', () => {
    for (const [reason] of cases) {
      const html = render(reason)
      assert.doesNotMatch(html, /\bnotes?\b/i)
      assert.doesNotMatch(html, /billing|payment|\bplan\b|\b20\d\d\b/i)
    }
  })
})
