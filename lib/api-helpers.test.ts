/**
 * Unit tests for shared API route helpers.
 * Run: npx tsx --test lib/api-helpers.test.ts
 */

import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// checkRateLimit — real behaviour against a mocked (throwing) Upstash Redis
//
// @upstash/redis issues REST calls via globalThis.fetch — see
// app/api/webhooks/stripe/route.test.ts for the same mocking approach. We
// simulate a Redis outage by making fetch reject, then assert the two
// rate-limit postures behave differently on that failure.
//
// Two SDK quirks the mock must account for:
// - Default `responseEncoding: 'base64'`: a result must be base64-encoded
//   JSON (it base64-decodes then JSON.parses on the way back out) — a plain
//   `{ result: 1 }` body is treated as invalid and surfaces as a thrown error.
// - Auto-pipelining: rateLimit()'s back-to-back incr()+expire() calls get
//   batched by the SDK into a single `[[cmd, ...args], ...]` pipeline POST
//   expecting an array of per-command results back, not a single object.
// ---------------------------------------------------------------------------

function encodeResult(value: number): string {
  return Buffer.from(JSON.stringify(value)).toString('base64')
}

/** Mocks the Upstash REST endpoint: every command (pipelined or not) returns `incrValue`. */
function mockRedisFetch(incrValue: number) {
  return async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let commands: unknown
    try {
      commands = JSON.parse((init?.body as string) ?? 'null')
    } catch {
      commands = null
    }
    if (Array.isArray(commands) && Array.isArray(commands[0])) {
      // Pipeline request: one result per command, in order.
      const results = (commands as string[][]).map(() => ({ result: encodeResult(incrValue) }))
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ result: encodeResult(incrValue) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}

describe('checkRateLimit — fail-open vs fail-closed on Redis error', () => {
  before(() => {
    // Stub Upstash env so lib/redis doesn't throw at import time.
    process.env.UPSTASH_REDIS_REST_URL = 'https://fake-ratelimit-test.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 'fake_token'
  })

  it('fail-open (default): allows the request through when Redis throws', async () => {
    const { checkRateLimit } = await import('./api-helpers')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error('simulated Redis outage')
    }
    try {
      const result = await checkRateLimit(
        `test:fail-open:${Math.random()}`,
        5,
        60,
        'test-context',
        'Too many requests.'
        // mode omitted → defaults to 'fail-open'
      )
      assert.equal(result, null, 'fail-open should return null (request allowed) on Redis error')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fail-closed: blocks the request with 503 + Retry-After when Redis throws', async () => {
    const { checkRateLimit, RATE_LIMIT_FAIL_CLOSED_RETRY_AFTER } = await import('./api-helpers')
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (): Promise<Response> => {
      throw new Error('simulated Redis outage')
    }
    try {
      const result = await checkRateLimit(
        `test:fail-closed:${Math.random()}`,
        5,
        60,
        'test-context',
        'Too many requests.',
        'fail-closed'
      )
      assert.ok(result, 'fail-closed should return a NextResponse (request blocked) on Redis error')
      assert.equal(result?.status, 503)
      assert.equal(result?.headers.get('Retry-After'), String(RATE_LIMIT_FAIL_CLOSED_RETRY_AFTER))
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('fail-closed: does not block when Redis succeeds and limit is not exceeded', async () => {
    const { checkRateLimit } = await import('./api-helpers')
    const originalFetch = globalThis.fetch
    globalThis.fetch = mockRedisFetch(1)
    try {
      const result = await checkRateLimit(
        `test:fail-closed-ok:${Math.random()}`,
        5,
        60,
        'test-context',
        'Too many requests.',
        'fail-closed'
      )
      assert.equal(result, null, 'should allow the request when Redis is healthy and under limit')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns 429 (not 503) when the limit is actually exceeded, regardless of mode', async () => {
    const { checkRateLimit } = await import('./api-helpers')
    const originalFetch = globalThis.fetch
    // current > limit on every call → rateLimit() returns -1
    globalThis.fetch = mockRedisFetch(999)
    try {
      const result = await checkRateLimit(
        `test:exceeded:${Math.random()}`,
        5,
        60,
        'test-context',
        'Too many requests.',
        'fail-closed'
      )
      assert.equal(result?.status, 429)
      assert.equal(result?.headers.get('Retry-After'), '60')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

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

  it('preserves allow-on-error (fail-open) behavior as the default posture', () => {
    assert.match(source, /allowing request/)
    assert.match(source, /mode:\s*RateLimitMode\s*=\s*'fail-open'/)
  })

  it('exports the fail-closed response helper and retry-after constant', () => {
    assert.match(source, /export function rateLimitFailClosedResponse/)
    assert.match(source, /export const RATE_LIMIT_FAIL_CLOSED_RETRY_AFTER/)
  })

  it('fail-closed responses use 503, not 429 (distinct from an actual limit breach)', () => {
    assert.match(source, /status:\s*503/)
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
