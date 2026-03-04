/**
 * Unit tests for the UploadProgress component.
 *
 * Tests source code invariants — no browser/React runtime needed.
 *
 * Run: npx tsx --test components/upload/UploadProgress.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname ?? __dirname, 'UploadProgress.tsx'), 'utf8')

describe('UploadProgress source code invariants', () => {
  it('has role="progressbar" for accessibility', () => {
    assert.match(source, /role="progressbar"/)
  })

  it('has aria-valuenow', () => {
    assert.match(source, /aria-valuenow/)
  })

  it('has aria-valuemin', () => {
    assert.match(source, /aria-valuemin/)
  })

  it('has aria-valuemax', () => {
    assert.match(source, /aria-valuemax/)
  })

  it('renders a Retry button in error state', () => {
    assert.match(source, /Retry/)
    assert.match(source, /onRetry/)
  })

  it('shows error message in error state', () => {
    assert.match(source, /status === 'error'/)
    assert.match(source, /error/)
  })

  it('exports UploadProgress', () => {
    assert.match(source, /export function UploadProgress/)
  })
})
