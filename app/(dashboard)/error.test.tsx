/**
 * (dashboard) route group error.tsx — source invariants
 * (node:test + fs.readFileSync pattern).
 *
 * Run: npx tsx --test "app/(dashboard)/error.test.tsx"
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('(dashboard) error.tsx — source invariants', () => {
  let source: string

  before(() => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'error.tsx')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('is a client component, as required by the Next.js error.tsx convention', () => {
    assert.match(source, /^['"]use client['"]/m)
  })

  it('has a default export accepting { error, reset }', () => {
    assert.match(source, /export default function \w+\(\{\s*error,\s*reset\s*\}/)
  })

  it('calls reset() to let the user retry', () => {
    assert.match(source, /onClick=\{reset\}/)
  })

  it('logs the caught error for observability', () => {
    assert.match(source, /console\.error\(/)
  })
})
