/**
 * Unit tests for shared UUID validation helpers.
 * Run: npx tsx --test lib/validation.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isValidUUID } from './validation'

describe('isValidUUID', () => {
  it('accepts a valid UUID (lowercase)', () => {
    assert.ok(isValidUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890'))
  })

  it('accepts a valid UUID (uppercase)', () => {
    assert.ok(isValidUUID('A1B2C3D4-E5F6-7890-ABCD-EF1234567890'))
  })

  it('rejects an empty string', () => {
    assert.ok(!isValidUUID(''))
  })

  it('rejects a plain string', () => {
    assert.ok(!isValidUUID('not-a-uuid'))
  })

  it('rejects SQL injection', () => {
    assert.ok(!isValidUUID("'; DROP TABLE videos; --"))
  })

  it('rejects a UUID missing a segment', () => {
    assert.ok(!isValidUUID('a1b2c3d4-e5f6-7890-abcd'))
  })

  it('rejects a UUID with extra characters', () => {
    assert.ok(!isValidUUID('a1b2c3d4-e5f6-7890-abcd-ef1234567890-extra'))
  })
})
