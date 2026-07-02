/**
 * DashboardError — source invariants (node:test + fs.readFileSync pattern).
 *
 * Run: npx tsx --test "components/dashboard/DashboardError.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('DashboardError — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'DashboardError.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('exports a DashboardError component', () => {
    assert.match(source, /export function DashboardError/)
  })

  it('accepts an optional message override with a sensible default', () => {
    assert.match(source, /message\?:\s*string/)
    assert.match(source, /DEFAULT_MESSAGE/)
  })

  it('uses the shared destructive text token, not a hardcoded color', () => {
    assert.match(source, /text-destructive/)
    assert.doesNotMatch(source, /text-red-\d/)
  })

  it('renders with an alert role for accessibility', () => {
    assert.match(source, /role="alert"/)
  })

  it('is server-component-safe (no client-only hooks)', () => {
    assert.doesNotMatch(source, /useState|useEffect|useCallback/)
  })
})
