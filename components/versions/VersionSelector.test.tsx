/**
 * Unit tests for VersionSelector component.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source-invariant checks, in particular the "controlled" versions
 * prop that lets a parent (the video page) pass down an already-fetched
 * versions list so VersionSelector doesn't duplicate the
 * GET /api/videos/:id/versions request.
 *
 * Run: npx tsx --test "components/versions/VersionSelector.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('VersionSelector — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'VersionSelector.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('exports the Version type for callers that pre-fetch it', () => {
    assert.match(source, /export interface Version/)
  })

  it('accepts an optional controlled `versions` prop', () => {
    assert.match(source, /versions\?: Version\[\] \| null/)
  })

  it('skips its own network fetch when running in controlled mode', () => {
    assert.match(source, /const isControlled = controlledVersions !== undefined/)
    assert.match(source, /if \(isControlled\) return/)
  })

  it('still fetches the versions endpoint when uncontrolled (backward compatible)', () => {
    assert.match(source, /fetch\(`\/api\/videos\/\$\{videoId\}\/versions`\)/)
  })

  it('auto-selects the latest version in both controlled and uncontrolled modes', () => {
    const matches = [...source.matchAll(/onVersionChange\(/g)]
    assert.ok(
      matches.length >= 2,
      'onVersionChange must be invoked for auto-select in both fetch modes'
    )
  })

  it('shows a loading state without fetching while the controlled data is still null', () => {
    assert.match(source, /controlledVersions === null/)
  })
})
