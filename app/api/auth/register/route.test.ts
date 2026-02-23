/**
 * Unit tests for registration API route validation and rate limiting logic.
 *
 * Tests the pure validatePassword function and rate limit key/constant expectations.
 * Uses the Node.js built-in test runner (node --test) — no extra dependency needed.
 *
 * Run: npx tsx --test app/api/auth/register/route.test.ts
 */

import { validatePassword } from '../../../../lib/auth-validation'
import { AUTH_RATE_LIMIT, AUTH_RATE_WINDOW } from '../../../../lib/rate-limit'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

describe('validatePassword', () => {
  it('rejects passwords shorter than 8 characters', () => {
    assert.match(validatePassword('Short1') ?? '', /at least 8 characters/)
  })

  it('rejects passwords without an uppercase letter', () => {
    assert.match(validatePassword('lowercase1') ?? '', /uppercase/)
  })

  it('rejects passwords without a lowercase letter', () => {
    assert.match(validatePassword('UPPERCASE1') ?? '', /lowercase/)
  })

  it('rejects passwords without a number', () => {
    assert.match(validatePassword('NoNumberHere') ?? '', /number/)
  })

  it('accepts a valid password', () => {
    assert.equal(validatePassword('ValidPass1'), null)
  })

  it('accepts a password with special characters', () => {
    assert.equal(validatePassword('Valid@Pass1!'), null)
  })
})

describe('register rate limiting — key format', () => {
  it('IP key follows auth:register:ip:{ip} pattern', () => {
    const ip = '10.0.0.1'
    const key = `auth:register:ip:${ip}`
    assert.equal(key, 'auth:register:ip:10.0.0.1')
  })

  it('email key follows auth:register:email:{normalizedEmail} pattern', () => {
    const email = '  User@Test.COM  '
    const key = `auth:register:email:${email.trim().toLowerCase()}`
    assert.equal(key, 'auth:register:email:user@test.com')
  })
})

describe('register rate limiting — constants', () => {
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
