/**
 * Unit tests for the upload page.
 *
 * Tests source code invariants — no browser/React runtime needed.
 *
 * Run: npx tsx --test "app/(dashboard)/upload/page.test.ts"
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(import.meta.dirname ?? __dirname, 'page.tsx'), 'utf8')

describe('upload page source code invariants', () => {
  it('imports useUpload', () => {
    assert.match(source, /useUpload/)
  })

  it('imports UploadZone', () => {
    assert.match(source, /UploadZone/)
  })

  it('imports UploadProgress', () => {
    assert.match(source, /UploadProgress/)
  })

  it('navigates to /videos/:id on success', () => {
    assert.match(source, /\/videos\//)
  })

  it('reads agencyId from search params', () => {
    assert.match(source, /agencyId/)
    assert.match(source, /searchParams|useSearchParams/)
  })

  it('shows missing agency message when agencyId absent', () => {
    assert.match(source, /[Mm]issing agency/)
  })

  it('redirects to sign-in when no session', () => {
    assert.match(source, /auth\/signin/)
  })

  it('is a client component', () => {
    assert.match(source, /'use client'/)
  })
})
