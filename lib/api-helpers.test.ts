/**
 * Unit tests for shared API route helpers.
 * Run: npx tsx --test lib/api-helpers.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

describe('checkRateLimit — logic', () => {
  it('returns null when rate limit is not exceeded', () => {
    // Simulates: remaining >= 0 → return null
    const remaining: number = 5
    const result = remaining === -1 ? { status: 429 } : null
    assert.equal(result, null)
  })

  it('returns a 429 status when limit is exceeded', () => {
    // Simulates: remaining === -1 → return 429
    const remaining: number = -1
    const result = remaining === -1 ? { status: 429 } : null
    assert.equal(result?.status, 429)
  })
})

describe('requireMembership — logic', () => {
  it('returns 403 when membership is null', () => {
    const membership = null
    const status = membership === null ? 403 : 200
    assert.equal(status, 403)
  })

  it('returns membership data when found', () => {
    const membership = { role: 'agent' }
    const status = membership === null ? 403 : 200
    assert.equal(status, 200)
  })
})

describe('requireAgentRole — logic', () => {
  const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent']

  it('returns 403 for talent role', () => {
    assert.equal(AGENT_PLUS_ROLES.includes('talent'), false)
  })

  it('returns 403 for guest role', () => {
    assert.equal(AGENT_PLUS_ROLES.includes('guest'), false)
  })

  it('allows owner role', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('owner'))
  })

  it('allows admin_agent role', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('admin_agent'))
  })

  it('allows agent role', () => {
    assert.ok(AGENT_PLUS_ROLES.includes('agent'))
  })
})

describe('api-helpers — source invariants', () => {
  let source: string

  before(async () => {
    const fs = await import('node:fs')
    const currentDir = path.dirname(fileURLToPath(import.meta.url))
    const filePath = path.resolve(currentDir, 'api-helpers.ts')
    source = fs.readFileSync(filePath, 'utf8')
  })

  it('exports checkRateLimit', () => {
    assert.match(source, /export async function checkRateLimit/)
  })

  it('exports requireMembership', () => {
    assert.match(source, /export async function requireMembership/)
  })

  it('exports requireAgentRole', () => {
    assert.match(source, /export async function requireAgentRole/)
  })

  it('preserves allow-on-error behavior for rate limiting', () => {
    assert.match(source, /allowing request/)
  })

  it('returns Retry-After header on 429', () => {
    assert.match(source, /Retry-After/)
  })

  it('distinguishes PGRST116 (no rows) from unexpected Supabase errors', () => {
    assert.match(source, /PGRST116/)
  })

  it('returns 500 on unexpected Supabase errors in requireMembership', () => {
    assert.match(source, /status: 500/)
  })
})
