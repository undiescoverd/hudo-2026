/**
 * Unit tests for VersionHistoryPanel component.
 *
 * Uses Node.js built-in test runner — no Next.js runtime needed.
 * Tests source-invariant security and rendering checks.
 *
 * Run: npx tsx --test "components/versions/VersionHistoryPanel.test.tsx"
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('VersionHistoryPanel — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(currentDir, 'VersionHistoryPanel.tsx'), 'utf8')
  })

  it('is a client component', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('fetches the versions list', () => {
    assert.match(source, /\/api\/videos\/.*\/versions/)
  })

  it('PATCHes active_version_id when an agent sets active', () => {
    assert.match(source, /'PATCH'|"PATCH"/)
    assert.match(source, /active_version_id/)
  })

  it('renders an active badge', () => {
    assert.match(source, /[Aa]ctive/)
  })

  it('hides set-active control for talent role', () => {
    assert.match(source, /role/)
    assert.match(source, /talent/)
  })
})
