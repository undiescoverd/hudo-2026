/**
 * Unit tests for registration API route validation logic.
 *
 * These test the pure validatePassword function without a running server.
 * Uses the Node.js built-in test runner (node --test) — no extra dependency needed.
 *
 * Run: node --test app/api/auth/register/route.test.ts
 * (transpile first via tsx: npx tsx --test app/api/auth/register/route.test.ts)
 */

import { validatePassword } from '../../../../lib/auth-validation'
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
