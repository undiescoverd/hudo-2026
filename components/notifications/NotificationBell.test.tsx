/**
 * Source-invariant tests for NotificationBell focus handling.
 * Run: npx tsx --test components/notifications/NotificationBell.test.tsx
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

describe('NotificationBell — focus', () => {
  let source: string

  before(() => {
    const dir = path.dirname(fileURLToPath(import.meta.url))
    source = fs.readFileSync(path.resolve(dir, 'NotificationBell.tsx'), 'utf8')
  })

  it('returns focus to the bell only after the panel was open (never on mount)', () => {
    assert.match(source, /const wasOpenRef = useRef\(false\)/)
    assert.match(source, /if \(open\) \{\s*wasOpenRef\.current = true\s*\}/)
    assert.match(
      source,
      /else if \(wasOpenRef\.current && buttonRef\.current\) \{\s*wasOpenRef\.current = false\s*buttonRef\.current\.focus\(\)/
    )
  })

  it('shows its focus ring for keyboard focus only, in the v3 ring colour', () => {
    assert.match(source, /focus-visible:ring-2 focus-visible:ring-ring/)
    assert.doesNotMatch(source, /focus:ring-blue-500/)
  })
})
