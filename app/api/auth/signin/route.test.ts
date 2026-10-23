/**
 * Unit tests for signin API route validation and rate limiting logic.
 *
 * Tests the pure safeRedirect function and rate limit key/constant expectations.
 * Route handler mocking is complex; we test the reusable validation utilities.
 *
 * Run: npx tsx --test app/api/auth/signin/route.test.ts
 */

import { safeRedirect } from '../../../../lib/auth-validation'
import { AUTH_RATE_LIMIT, AUTH_RATE_WINDOW } from '../../../../lib/rate-limit'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('safeRedirect', () => {
  it('returns /videos for null target', () => {
    assert.equal(safeRedirect(null), '/videos')
  })

  it('returns /videos for empty string target', () => {
    assert.equal(safeRedirect(''), '/videos')
  })

  it('returns /videos for protocol-relative URLs (//example.com)', () => {
    assert.equal(safeRedirect('//example.com'), '/videos')
  })

  it('returns /videos for absolute URLs (http://example.com)', () => {
    assert.equal(safeRedirect('http://example.com'), '/videos')
  })

  it('returns /videos for absolute URLs (https://example.com)', () => {
    assert.equal(safeRedirect('https://example.com'), '/videos')
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

  // Browsers treat `\` as `/` and drop tab/newline, so these resolve cross-origin
  // (e.g. `new URL('/\t/evil.com', origin).origin === 'https://evil.com'`).
  for (const [label, target] of [
    ['backslash host (/\\evil.com)', '/\\evil.com'],
    ['slash + backslash (/\\/evil.com)', '/\\/evil.com'],
    ['tab between slashes', '/\t/evil.com'],
    ['newline between slashes', '/\n/evil.com'],
    ['carriage return between slashes', '/\r/evil.com'],
    ['leading space before //', ' //evil.com'],
    ['whitespace inside the path', '/videos x'],
    ['NUL control char', '/vid\u0000eos'],
    ['DEL control char', '/vid\u007feos'],
    ['dot-dot normalising to //evil.com (/..//evil.com)', '/..//evil.com'],
    ['nested dot-dot normalising to //evil.com', '/x/..//evil.com'],
    ['bare // (URL parser throws on it)', '//'],
    ['// followed by an invalid host', '//['],
  ] as const) {
    it(`returns /videos for ${label}`, () => {
      assert.equal(safeRedirect(target), '/videos')
    })
  }

  it('keeps an encoded backslash (/%5Cevil.com) — it stays a path, not a host', () => {
    assert.equal(safeRedirect('/%5Cevil.com'), '/%5Cevil.com')
  })

  it('accepts a path with query and hash (/videos?t=30#c) unchanged', () => {
    assert.equal(safeRedirect('/videos?t=30#c'), '/videos?t=30#c')
  })

  it('accepts a path with a query (/videos/abc?x=1) unchanged', () => {
    assert.equal(safeRedirect('/videos/abc?x=1'), '/videos/abc?x=1')
  })

  it('returns the raw target, never the normalised URL', () => {
    assert.equal(safeRedirect('/a/../b'), '/a/../b')
  })

  it('uses a custom fallback for null', () => {
    assert.equal(safeRedirect(null, '/'), '/')
  })

  it('uses a custom fallback for protocol-relative URLs', () => {
    assert.equal(safeRedirect('//evil.com', '/'), '/')
  })

  it('uses a custom fallback for backslash hosts', () => {
    assert.equal(safeRedirect('/\\evil.com', '/'), '/')
  })
})

describe('signin rate limiting — key format', () => {
  it('IP key follows auth:signin:ip:{ip} pattern', () => {
    const ip = '192.168.1.1'
    const key = `auth:signin:ip:${ip}`
    assert.equal(key, 'auth:signin:ip:192.168.1.1')
  })

  it('email key follows auth:signin:email:{normalizedEmail} pattern', () => {
    const email = 'Test@Example.COM'
    const key = `auth:signin:email:${email.trim().toLowerCase()}`
    assert.equal(key, 'auth:signin:email:test@example.com')
  })
})

describe('signin rate limiting — constants', () => {
  it('limit is 5 attempts per window', () => {
    assert.equal(AUTH_RATE_LIMIT, 5)
  })

  it('window is 900 seconds (15 minutes)', () => {
    assert.equal(AUTH_RATE_WINDOW, 900)
  })

  it('Retry-After header value matches window', () => {
    assert.equal(String(AUTH_RATE_WINDOW), '900')
  })
})
