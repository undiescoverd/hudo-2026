/**
 * Unit tests for lib/auth.ts — role utility functions (S0-AUTH-006)
 *
 * Tests the pure roleAtLeast helper without a running server or browser.
 * Uses the Node.js built-in test runner — no extra dependency needed.
 *
 * Run: npx tsx --test lib/auth.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { roleAtLeast, type UserRole } from './auth'

describe('roleAtLeast — role hierarchy checks', () => {
  // Hierarchy: owner > admin_agent > agent > talent

  it('owner meets owner requirement', () => {
    assert.equal(roleAtLeast('owner', 'owner'), true)
  })

  it('owner meets admin_agent requirement', () => {
    assert.equal(roleAtLeast('owner', 'admin_agent'), true)
  })

  it('owner meets agent requirement', () => {
    assert.equal(roleAtLeast('owner', 'agent'), true)
  })

  it('owner meets talent requirement', () => {
    assert.equal(roleAtLeast('owner', 'talent'), true)
  })

  it('admin_agent does not meet owner requirement', () => {
    assert.equal(roleAtLeast('admin_agent', 'owner'), false)
  })

  it('admin_agent meets admin_agent requirement', () => {
    assert.equal(roleAtLeast('admin_agent', 'admin_agent'), true)
  })

  it('admin_agent meets agent requirement', () => {
    assert.equal(roleAtLeast('admin_agent', 'agent'), true)
  })

  it('admin_agent meets talent requirement', () => {
    assert.equal(roleAtLeast('admin_agent', 'talent'), true)
  })

  it('agent does not meet owner requirement', () => {
    assert.equal(roleAtLeast('agent', 'owner'), false)
  })

  it('agent does not meet admin_agent requirement', () => {
    assert.equal(roleAtLeast('agent', 'admin_agent'), false)
  })

  it('agent meets agent requirement', () => {
    assert.equal(roleAtLeast('agent', 'agent'), true)
  })

  it('agent meets talent requirement', () => {
    assert.equal(roleAtLeast('agent', 'talent'), true)
  })

  it('talent does not meet owner requirement', () => {
    assert.equal(roleAtLeast('talent', 'owner'), false)
  })

  it('talent does not meet admin_agent requirement', () => {
    assert.equal(roleAtLeast('talent', 'admin_agent'), false)
  })

  it('talent does not meet agent requirement', () => {
    assert.equal(roleAtLeast('talent', 'agent'), false)
  })

  it('talent meets talent requirement', () => {
    assert.equal(roleAtLeast('talent', 'talent'), true)
  })
})

describe('UserRole type — valid role values', () => {
  it('covers all four defined roles', () => {
    const roles: UserRole[] = ['owner', 'admin_agent', 'agent', 'talent']
    assert.equal(roles.length, 4)
  })
})
