/**
 * (dashboard) route group loading.tsx — source invariants
 * (node:test + fs.readFileSync pattern).
 *
 * Run: npx tsx --test "app/(dashboard)/loading.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('(dashboard) loading.tsx — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'loading.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('has a default export as required by the Next.js loading.tsx convention', () => {
    assert.match(source, /export default function \w+/)
  })

  it('renders a spinner', () => {
    assert.match(source, /animate-spin/)
  })

  it('exposes a loading status role for accessibility', () => {
    assert.match(source, /role="status"/)
  })

  it('does not need to be a client component', () => {
    assert.doesNotMatch(source, /^['"]use client['"]/m)
  })
})
