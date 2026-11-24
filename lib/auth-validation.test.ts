import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { safeRedirect } from './auth-validation'

describe('safeRedirect', () => {
  it('defaults to /dashboard', () => {
    assert.equal(safeRedirect(null), '/dashboard')
    assert.equal(safeRedirect(''), '/dashboard')
  })

  it('keeps a safe deep link unchanged', () => {
    assert.equal(safeRedirect('/videos/abc?t=12'), '/videos/abc?t=12')
  })

  it('rejects open-redirect targets', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com']) {
      assert.equal(safeRedirect(bad), '/dashboard', bad)
    }
  })

  it('honours an explicit fallback', () => {
    assert.equal(safeRedirect('//evil.com', '/x'), '/x')
  })
})
