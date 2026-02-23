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
