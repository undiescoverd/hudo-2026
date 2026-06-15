/**
 * Unit tests for lib/plan-gates.ts
 *
 * All Supabase and Redis calls are mocked via simple in-memory stubs.
 * Run: npx tsx --test lib/plan-gates.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkPlanLimit,
  invalidatePlanLimitCache,
  planLimitCacheKey,
  PLAN_LIMITS,
  PLAN_LIMIT_CACHE_TTL,
  PlanLimitUnavailableError,
  type CacheClient,
} from './plan-gates'
import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple in-memory cache mock */
function makeCache(initial: Record<string, unknown> = {}): CacheClient & {
  store: Record<string, unknown>
  setCalls: Array<{ key: string; value: unknown; options: { ex: number } }>
} {
  const store: Record<string, unknown> = { ...initial }
  const setCalls: Array<{ key: string; value: unknown; options: { ex: number } }> = []
  return {
    store,
    setCalls,
    async get<T>(key: string) {
      return (key in store ? store[key] : null) as T | null
    },
    async set(key: string, value: unknown, options: { ex: number }) {
      store[key] = value
      setCalls.push({ key, value, options })
      return 'OK'
    },
    async del(key: string) {
      delete store[key]
      return 1
    },
  }
}

/**
 * Supabase admin mock that properly resolves the chained query.
 */
function makeAdminFull({
  plan = 'freemium',
  count = 0,
  countError = null as { message: string; code?: string } | null,
}: {
  plan?: string
  count?: number
  countError?: { message: string; code?: string } | null
}) {
  let agencyQueryCalled = 0
  let countQueryCalled = 0

  const tracker = {
    get agencyQueryCalled() {
      return agencyQueryCalled
    },
    get countQueryCalled() {
      return countQueryCalled
    },
  }

  const countResult = { count: countError ? null : count, error: countError }

  // A thenable that also handles chained .eq() / .in() calls.
  // We use `unknown` return types to avoid TS intersection conflicts.
  function makeChainable(): unknown {
    const self: Record<string, unknown> = {}
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    self['eq'] = (..._args: unknown[]) => self
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    self['in'] = (..._args: unknown[]) => Promise.resolve(countResult)
    self['then'] = (resolve: (v: unknown) => unknown) => Promise.resolve(countResult).then(resolve)
    return self
  }

  const client = {
    _tracker: tracker,
    from(table: string) {
      if (table === 'agencies') {
        agencyQueryCalled++
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { plan }, error: null }),
            }),
          }),
        }
      }
      if (table === 'memberships') {
        countQueryCalled++
        return {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          select: (..._args: unknown[]) => makeChainable(),
        }
      }
      return {}
    },
  }

  return client as unknown as SupabaseClient & { _tracker: typeof tracker }
}

// ---------------------------------------------------------------------------
// PLAN_LIMITS config
// ---------------------------------------------------------------------------

describe('PLAN_LIMITS config', () => {
  it('freemium has 5 agent seats and 10 talent seats', () => {
    assert.equal(PLAN_LIMITS.freemium.agents, 5)
    assert.equal(PLAN_LIMITS.freemium.talent, 10)
  })

  it('starter has more seats than freemium', () => {
    assert.ok(PLAN_LIMITS.starter.agents > PLAN_LIMITS.freemium.agents)
    assert.ok(PLAN_LIMITS.starter.talent > PLAN_LIMITS.freemium.talent)
  })

  it('studio has more seats than starter', () => {
    assert.ok(PLAN_LIMITS.studio.agents > PLAN_LIMITS.starter.agents)
    assert.ok(PLAN_LIMITS.studio.talent > PLAN_LIMITS.starter.talent)
  })

  it('agency_pro has the largest limits', () => {
    assert.ok(PLAN_LIMITS.agency_pro.agents >= PLAN_LIMITS.studio.agents)
    assert.ok(PLAN_LIMITS.agency_pro.talent >= PLAN_LIMITS.studio.talent)
  })

  it('cache TTL is ≤ 60 seconds', () => {
    assert.ok(PLAN_LIMIT_CACHE_TTL <= 60)
  })
})

// ---------------------------------------------------------------------------
// planLimitCacheKey
// ---------------------------------------------------------------------------

describe('planLimitCacheKey', () => {
  it('generates the correct key for agents', () => {
    const key = planLimitCacheKey('abc-123', 'agents')
    assert.equal(key, 'plan-limit:abc-123:agents')
  })

  it('generates the correct key for talent', () => {
    const key = planLimitCacheKey('abc-123', 'talent')
    assert.equal(key, 'plan-limit:abc-123:talent')
  })
})

// ---------------------------------------------------------------------------
// invalidatePlanLimitCache
// ---------------------------------------------------------------------------

describe('invalidatePlanLimitCache', () => {
  it('deletes the cache key for the given agency + category', async () => {
    const cache = makeCache({ 'plan-limit:agency-1:agents': 3 })
    await invalidatePlanLimitCache(cache, 'agency-1', 'agents')
    assert.equal(await cache.get('plan-limit:agency-1:agents'), null)
  })

  it('does not delete unrelated keys', async () => {
    const cache = makeCache({
      'plan-limit:agency-1:agents': 3,
      'plan-limit:agency-1:talent': 5,
    })
    await invalidatePlanLimitCache(cache, 'agency-1', 'agents')
    assert.equal(await cache.get('plan-limit:agency-1:talent'), 5)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — cache hit
// ---------------------------------------------------------------------------

describe('checkPlanLimit — cache hit', () => {
  it('returns allowed=true when cached count is below limit', async () => {
    const agencyId = 'agency-cache-hit'
    const cache = makeCache({ [planLimitCacheKey(agencyId, 'agents')]: 4 }) // under freemium limit 5
    const admin = makeAdminFull({ plan: 'freemium', count: 99 }) // count in DB is irrelevant

    const result = await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(result.allowed, true)
    assert.equal(result.limit, 5)
    assert.equal(result.current, 4)
    // DB count was NOT called — cache hit served the value
    assert.equal(admin._tracker.countQueryCalled, 0)
  })

  it('returns allowed=false when cached count equals limit (at-limit blocks)', async () => {
    const agencyId = 'agency-at-limit'
    const cache = makeCache({ [planLimitCacheKey(agencyId, 'agents')]: 5 }) // at freemium limit
    const admin = makeAdminFull({ plan: 'freemium', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 5)
    assert.equal(result.current, 5)
    assert.equal(admin._tracker.countQueryCalled, 0)
  })

  it('returns allowed=false when cached count exceeds limit', async () => {
    const agencyId = 'agency-over-limit'
    const cache = makeCache({ [planLimitCacheKey(agencyId, 'talent')]: 11 })
    const admin = makeAdminFull({ plan: 'freemium', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'talent')

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 10)
    assert.equal(result.current, 11)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — cache miss (DB read + cache populate)
// ---------------------------------------------------------------------------

describe('checkPlanLimit — cache miss', () => {
  it('reads DB and populates cache on cache miss', async () => {
    const agencyId = 'agency-cache-miss'
    const cache = makeCache() // empty cache
    const admin = makeAdminFull({ plan: 'freemium', count: 3 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(result.allowed, true)
    assert.equal(result.current, 3)
    assert.equal(result.limit, 5)
    // DB count was called once
    assert.equal(admin._tracker.countQueryCalled, 1)
    // Cache was populated
    const cached = await cache.get<number>(planLimitCacheKey(agencyId, 'agents'))
    assert.equal(cached, 3)
  })

  it('blocks when DB count is at limit', async () => {
    const agencyId = 'agency-miss-blocked'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'freemium', count: 5 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 5)
    assert.equal(result.current, 5)
  })

  it('respects plan limits for higher tiers', async () => {
    const agencyId = 'agency-studio'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'studio', count: 20 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(result.allowed, true)
    assert.equal(result.limit, PLAN_LIMITS.studio.agents)
  })

  it('calls cache.set with options.ex === PLAN_LIMIT_CACHE_TTL on cache miss + successful count', async () => {
    const agencyId = 'agency-ttl-check'
    const cache = makeCache() // empty — forces DB read
    const admin = makeAdminFull({ plan: 'freemium', count: 2 })

    await checkPlanLimit(admin, cache, agencyId, 'agents')

    assert.equal(cache.setCalls.length, 1)
    assert.equal(cache.setCalls[0].options.ex, PLAN_LIMIT_CACHE_TTL)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — fail-closed on count error
// ---------------------------------------------------------------------------

describe('checkPlanLimit — fail-closed on count error', () => {
  it('throws PlanLimitUnavailableError when countSeats returns null (DB error)', async () => {
    const agencyId = 'agency-db-error'
    const cache = makeCache() // empty — forces DB read
    const admin = makeAdminFull({
      plan: 'freemium',
      countError: { message: 'connection refused', code: 'PGRST000' },
    })

    await assert.rejects(
      () => checkPlanLimit(admin, cache, agencyId, 'agents'),
      (err: unknown) => err instanceof PlanLimitUnavailableError
    )
  })

  it('does NOT call cache.set when count query errors', async () => {
    const agencyId = 'agency-no-cache-on-error'
    const cache = makeCache() // empty — forces DB read
    const admin = makeAdminFull({
      plan: 'freemium',
      countError: { message: 'timeout', code: 'PGRST000' },
    })

    try {
      await checkPlanLimit(admin, cache, agencyId, 'agents')
    } catch {
      // expected
    }

    assert.equal(cache.setCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — gate result shape (for 402 response body)
// ---------------------------------------------------------------------------

describe('checkPlanLimit — result shape for 402 body', () => {
  it('returns numeric limit and current when blocked', async () => {
    const agencyId = 'agency-exact-error'
    const cache = makeCache({ [planLimitCacheKey(agencyId, 'talent')]: 10 })
    const admin = makeAdminFull({ plan: 'freemium', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId, 'talent')

    assert.equal(result.allowed, false)
    assert.equal(typeof result.limit, 'number')
    assert.equal(typeof result.current, 'number')
    assert.equal(result.limit, 10)
    assert.equal(result.current, 10)
  })
})

// ---------------------------------------------------------------------------
// Source invariants for route files
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readRoute(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, relPath), 'utf8')
}

describe('members route — source invariants', () => {
  const src = readRoute('../app/api/agencies/[id]/members/route.ts')

  it('exports a POST handler', () => {
    assert.match(src, /export async function POST/)
  })

  it('checks auth (Authentication required)', () => {
    assert.match(src, /Authentication required/)
  })

  it('validates agency ID as UUID', () => {
    assert.match(src, /isValidUUID/)
  })

  it('uses service-role client for DB ops', () => {
    assert.match(src, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('calls checkPlanLimit for the "agents" category', () => {
    assert.match(src, /checkPlanLimit/)
    assert.match(src, /'agents'/)
  })

  it('returns 402 on plan_limit_exceeded', () => {
    assert.match(src, /plan_limit_exceeded/)
    assert.match(src, /status:\s*402/)
  })

  it('response body includes limit and current fields', () => {
    assert.match(src, /gate\.limit/)
    assert.match(src, /gate\.current/)
  })

  it('invalidates cache after successful insert', () => {
    assert.match(src, /invalidatePlanLimitCache/)
  })

  it('restricts to owner/admin_agent only (ADD_MEMBER_ROLES)', () => {
    assert.match(src, /ADD_MEMBER_ROLES/)
  })

  it('uses rate limiting', () => {
    assert.match(src, /checkRateLimit/)
  })

  it('error body uses exact string plan_limit_exceeded', () => {
    assert.match(src, /error:\s*'plan_limit_exceeded'/)
  })

  it('returns 503 on PlanLimitUnavailableError (fail-closed)', () => {
    assert.match(src, /PlanLimitUnavailableError/)
    assert.match(src, /status:\s*503/)
  })
})

describe('talent route — source invariants', () => {
  const src = readRoute('../app/api/agencies/[id]/talent/route.ts')

  it('exports a POST handler', () => {
    assert.match(src, /export async function POST/)
  })

  it('checks auth (Authentication required)', () => {
    assert.match(src, /Authentication required/)
  })

  it('validates agency ID as UUID', () => {
    assert.match(src, /isValidUUID/)
  })

  it('uses service-role client for DB ops', () => {
    assert.match(src, /createClient\(supabaseUrl,\s*serviceRoleKey\)/)
  })

  it('calls checkPlanLimit for the "talent" category', () => {
    assert.match(src, /checkPlanLimit/)
    assert.match(src, /'talent'/)
  })

  it('returns 402 on plan_limit_exceeded', () => {
    assert.match(src, /plan_limit_exceeded/)
    assert.match(src, /status:\s*402/)
  })

  it('response body includes limit and current fields', () => {
    assert.match(src, /gate\.limit/)
    assert.match(src, /gate\.current/)
  })

  it('invalidates cache after successful insert', () => {
    assert.match(src, /invalidatePlanLimitCache/)
  })

  it('restricts to owner/admin_agent only (ADD_TALENT_ROLES)', () => {
    assert.match(src, /ADD_TALENT_ROLES/)
  })

  it('inserts membership with role "talent"', () => {
    assert.match(src, /role:\s*'talent'/)
  })

  it('uses rate limiting', () => {
    assert.match(src, /checkRateLimit/)
  })

  it('error body uses exact string plan_limit_exceeded', () => {
    assert.match(src, /error:\s*'plan_limit_exceeded'/)
  })

  it('returns 503 on PlanLimitUnavailableError (fail-closed)', () => {
    assert.match(src, /PlanLimitUnavailableError/)
    assert.match(src, /status:\s*503/)
  })
})

describe('plan-gates.ts — source invariants', () => {
  const src = readRoute('./plan-gates.ts')

  it('defines PLAN_LIMITS freemium with 5 agents', () => {
    assert.match(src, /freemium.*agents.*5/)
  })

  it('defines PLAN_LIMITS freemium with 10 talent', () => {
    assert.match(src, /freemium.*talent.*10/)
  })

  it('exports checkPlanLimit function', () => {
    assert.match(src, /export async function checkPlanLimit/)
  })

  it('exports invalidatePlanLimitCache function', () => {
    assert.match(src, /export async function invalidatePlanLimitCache/)
  })

  it('cache TTL constant is defined', () => {
    assert.match(src, /PLAN_LIMIT_CACHE_TTL\s*=\s*\d+/)
  })

  it('uses CacheClient interface (not a direct redis import)', () => {
    assert.match(src, /CacheClient/)
    assert.doesNotMatch(src, /from '@\/lib\/redis'/)
  })

  it('exports PlanLimitUnavailableError class', () => {
    assert.match(src, /export class PlanLimitUnavailableError/)
  })

  it('countSeats returns null on error (fail-closed signal)', () => {
    assert.match(src, /return null/)
  })
})
