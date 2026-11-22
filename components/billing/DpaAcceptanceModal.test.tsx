/**
 * DpaAcceptanceModal — links to the in-app /dpa page and shares the processor
 * name with the legal pages (S4-LAUNCH-001 review).
 *
 * Run: npx tsx --test "components/billing/DpaAcceptanceModal.test.tsx"
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DpaAcceptanceModal } from './DpaAcceptanceModal'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const read = (rel: string) => fs.readFileSync(path.resolve(repoRoot, rel), 'utf8')

describe('DpaAcceptanceModal — legal links', () => {
  const html = renderToStaticMarkup(
    React.createElement(DpaAcceptanceModal, {
      agencyId: 'agency-1',
      onAccepted: () => {},
      onCancel: () => {},
    })
  )

  it('links the sub-processor list to the in-app /dpa#sub-processors anchor', () => {
    assert.match(html, /href="\/dpa#sub-processors"/)
    assert.match(html, /target="_blank"/)
    assert.match(html, /rel="noopener noreferrer"/)
  })

  it('no longer points at the non-existent hudo.io sub-processor page', () => {
    assert.doesNotMatch(html, /hudo\.io/)
    assert.doesNotMatch(read('components/billing/DpaAcceptanceModal.tsx'), /hudo\.io/)
  })

  it('names the processor as Hudo, matching the /terms, /privacy and /dpa pages', () => {
    assert.match(html, /Hudo/)
    for (const page of [
      'app/(public)/terms/page.tsx',
      'app/(public)/privacy/page.tsx',
      'app/(public)/dpa/page.tsx',
    ]) {
      assert.match(read(page), /Hudo/, page)
    }
  })

  it('the /dpa page exposes the #sub-processors anchor the modal links to', () => {
    assert.match(read('app/(public)/dpa/page.tsx'), /id="sub-processors"/)
  })
})
