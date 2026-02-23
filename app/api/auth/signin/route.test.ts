/**
 * Unit tests for signin API route validation logic.
 *
 * These test the pure safeRedirect function without a running server.
 * Route handler mocking is complex; we test the reusable validation utilities.
 *
 * Run: npx tsx --test app/api/auth/signin/route.test.ts
 */

import { safeRedirect } from '../../../../lib/auth-validation'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('safeRedirect', () => {
  it('returns / for null target', () => {
    assert.equal(safeRedirect(null), '/')
  })

  it('returns / for empty string target', () => {
    assert.equal(safeRedirect(''), '/')
  })

  it('returns / for protocol-relative URLs (//example.com)', () => {
    assert.equal(safeRedirect('//example.com'), '/')
  })

  it('returns / for absolute URLs (http://example.com)', () => {
    assert.equal(safeRedirect('http://example.com'), '/')
  })

  it('returns / for absolute URLs (https://example.com)', () => {
    assert.equal(safeRedirect('https://example.com'), '/')
  })

  it('accepts a valid local path (/dashboard)', () => {
    assert.equal(safeRedirect('/dashboard'), '/dashboard')
  })

  it('accepts a valid local path with query params (/dashboard?tab=settings)', () => {
    assert.equal(safeRedirect('/dashboard?tab=settings'), '/dashboard?tab=settings')
  })

  it('accepts a deep local path (/foo/bar/baz)', () => {
    assert.equal(safeRedirect('/foo/bar/baz'), '/foo/bar/baz')
  })
})
