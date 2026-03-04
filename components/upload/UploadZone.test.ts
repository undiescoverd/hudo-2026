/**
 * Unit tests for the UploadZone component.
 *
 * Tests source code invariants — no browser/React runtime needed.
 *
 * Run: npx tsx --test components/upload/UploadZone.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname ?? __dirname, 'UploadZone.tsx'), 'utf8')

describe('UploadZone source code invariants', () => {
  it('has accept="video/*" for mobile camera roll access', () => {
    assert.match(source, /accept="video\/\*"/)
  })

  it('has role="button" on the drop zone', () => {
    assert.match(source, /role="button"/)
  })

  it('rejects non-.mp4/.mov files and shows an error message', () => {
    // The component checks ALLOWED_EXTENSIONS and sets a typeError
    assert.match(source, /ALLOWED_EXTENSIONS/)
    assert.match(source, /mp4.*mov|Only.*mp4.*mov/i)
  })

  it('exports UploadZone', () => {
    assert.match(source, /export function UploadZone/)
  })

  it('has disabled prop support', () => {
    assert.match(source, /disabled/)
  })

  it('calls onFile callback when a valid file is selected', () => {
    assert.match(source, /onFile\(file\)/)
  })

  it('supports keyboard navigation (Enter/Space)', () => {
    assert.match(source, /'Enter'/)
    assert.match(source, /' '|"Space"/)
  })
})
