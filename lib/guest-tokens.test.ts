/**
 * Unit tests for lib/guest-tokens.ts (S2-GUEST-001)
 *
 * Run: npx tsx --test lib/guest-tokens.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { generateGuestToken, hashGuestToken, verifyGuestToken } from './guest-tokens'

describe('generateGuestToken', () => {
  it('produces a 43-character base64url string (32 bytes, no padding)', () => {
    const token = generateGuestToken()
    assert.equal(typeof token, 'string')
    assert.equal(token.length, 43)
    // base64url chars only (no +, /, or =)
    assert.match(token, /^[A-Za-z0-9_-]{43}$/)
  })

  it('decodes back to exactly 32 bytes of entropy', () => {
    const token = generateGuestToken()
    const decoded = Buffer.from(token, 'base64url')
    assert.equal(decoded.length, 32)
  })

  it('generates unique tokens (1000 samples)', () => {
    const tokens = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      tokens.add(generateGuestToken())
    }
    assert.equal(tokens.size, 1000)
  })
})

describe('hashGuestToken', () => {
  it('returns the known SHA-256 hex digest of "hello"', () => {
    const expected = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    assert.equal(hashGuestToken('hello'), expected)
  })

  it('is deterministic — same input produces same hash', () => {
    const token = generateGuestToken()
    assert.equal(hashGuestToken(token), hashGuestToken(token))
  })
})

describe('verifyGuestToken', () => {
  it('returns true for matching plaintext and hash', () => {
    const plain = generateGuestToken()
    assert.equal(verifyGuestToken(plain, hashGuestToken(plain)), true)
  })

  it('returns false for non-matching plaintext and hash', () => {
    assert.equal(verifyGuestToken('wrong', hashGuestToken('right')), false)
  })

  it('returns false safely for malformed expectedHash (not a hex string)', () => {
    // Buffer.from('not-a-hex-string', 'hex') produces a short/empty buffer;
    // the length guard must return false without calling timingSafeEqual.
    assert.equal(verifyGuestToken('plain', 'not-a-hex-string'), false)
  })

  it('returns false for empty expectedHash', () => {
    assert.equal(verifyGuestToken('plain', ''), false)
  })
})
