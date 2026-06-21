/**
 * Unit tests for lib/plan-gates.ts
 *
 * All Supabase and Redis calls are mocked via simple in-memory stubs.
 * Run: npx tsx --test lib/plan-gates.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  checkPlanLimit,
  canAddAgent,
  canUploadVideo,
  invalidatePlanLimitCache,
  planLimitCacheKey,
  PLAN_LIMIT_CACHE_TTL,
  PlanLimitUnavailableError,
  isGracePeriodExpired,
  AGENT_SEAT_ROLES,
  getAgentSeatLimit,
  getStorageLimitBytes,
  getPlan,
  type CacheClient,
} from './plan-gates'
import { GiB } from './plans'
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
  agencyError = null as { message: string; code?: string } | null,
}: {
  plan?: string
  count?: number
  countError?: { message: string; code?: string } | null
  agencyError?: { message: string; code?: string } | null
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
              single: async () => ({
                data: agencyError ? null : { plan },
                error: agencyError,
              }),
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
// planLimitCacheKey
// ---------------------------------------------------------------------------

describe('planLimitCacheKey', () => {
  it('generates the correct agents key for an agency', () => {
    const key = planLimitCacheKey('abc-123')
    assert.equal(key, 'plan-limit:abc-123:agents')
  })

  it('includes the agencyId in the key', () => {
    const key = planLimitCacheKey('my-agency-id')
    assert.ok(key.includes('my-agency-id'))
  })
})

// ---------------------------------------------------------------------------
// PLAN_LIMIT_CACHE_TTL
// ---------------------------------------------------------------------------

describe('PLAN_LIMIT_CACHE_TTL', () => {
  it('cache TTL is ≤ 60 seconds', () => {
    assert.ok(PLAN_LIMIT_CACHE_TTL <= 60)
  })

  it('cache TTL is a positive number', () => {
    assert.ok(PLAN_LIMIT_CACHE_TTL > 0)
  })
})

// ---------------------------------------------------------------------------
// AGENT_SEAT_ROLES
// ---------------------------------------------------------------------------

describe('AGENT_SEAT_ROLES', () => {
  it('contains owner, admin_agent, agent', () => {
    assert.ok(AGENT_SEAT_ROLES.includes('owner'))
    assert.ok(AGENT_SEAT_ROLES.includes('admin_agent'))
    assert.ok(AGENT_SEAT_ROLES.includes('agent'))
  })

  it('does not contain talent', () => {
    assert.ok(!(AGENT_SEAT_ROLES as readonly string[]).includes('talent'))
  })
})

// ---------------------------------------------------------------------------
// getAgentSeatLimit
// ---------------------------------------------------------------------------

describe('getAgentSeatLimit', () => {
  it('returns 1 for freemium', () => {
    assert.equal(getAgentSeatLimit('freemium'), 1)
  })

  it('returns 3 for starter', () => {
    assert.equal(getAgentSeatLimit('starter'), 3)
  })

  it('returns 8 for studio', () => {
    assert.equal(getAgentSeatLimit('studio'), 8)
  })

  it('returns 20 for agency_pro', () => {
    assert.equal(getAgentSeatLimit('agency_pro'), 20)
  })

  it('falls back to freemium (1) for unknown plan string', () => {
    assert.equal(getAgentSeatLimit('unknown_plan'), 1)
  })

  it('tiers strictly increase: freemium < starter < studio < agency_pro', () => {
    assert.ok(getAgentSeatLimit('freemium') < getAgentSeatLimit('starter'))
    assert.ok(getAgentSeatLimit('starter') < getAgentSeatLimit('studio'))
    assert.ok(getAgentSeatLimit('studio') < getAgentSeatLimit('agency_pro'))
  })
})

// ---------------------------------------------------------------------------
// getStorageLimitBytes
// ---------------------------------------------------------------------------

describe('getStorageLimitBytes', () => {
  it('returns 10 GiB (10737418240) for freemium', () => {
    assert.equal(getStorageLimitBytes('freemium'), 10 * GiB)
    assert.equal(getStorageLimitBytes('freemium'), 10_737_418_240)
  })

  it('returns 100 GiB (107374182400) for starter', () => {
    assert.equal(getStorageLimitBytes('starter'), 100 * GiB)
    assert.equal(getStorageLimitBytes('starter'), 107_374_182_400)
  })

  it('returns 500 GiB (536870912000) for studio', () => {
    assert.equal(getStorageLimitBytes('studio'), 500 * GiB)
    assert.equal(getStorageLimitBytes('studio'), 536_870_912_000)
  })

  it('returns 1024 GiB (1099511627776) for agency_pro', () => {
    assert.equal(getStorageLimitBytes('agency_pro'), 1024 * GiB)
    assert.equal(getStorageLimitBytes('agency_pro'), 1_099_511_627_776)
  })

  it('falls back to freemium (10 GiB) for unknown plan string', () => {
    assert.equal(getStorageLimitBytes('unknown_plan'), 10 * GiB)
  })
})

// ---------------------------------------------------------------------------
// getPlan
// ---------------------------------------------------------------------------

describe('getPlan', () => {
  it('returns the freemium plan for "freemium"', () => {
    const plan = getPlan('freemium')
    assert.equal(plan.id, 'freemium')
    assert.equal(plan.agentSeats, 1)
    assert.equal(plan.talentLimit, null)
  })

  it('returns the starter plan for "starter"', () => {
    const plan = getPlan('starter')
    assert.equal(plan.id, 'starter')
    assert.equal(plan.agentSeats, 3)
  })

  it('falls back to freemium for unknown string', () => {
    const plan = getPlan('totally_unknown')
    assert.equal(plan.id, 'freemium')
  })

  it('talentLimit is null on every tier (talent is unlimited)', () => {
    for (const planId of ['freemium', 'starter', 'studio', 'agency_pro']) {
      assert.equal(getPlan(planId).talentLimit, null)
    }
  })
})

// ---------------------------------------------------------------------------
// canUploadVideo
// ---------------------------------------------------------------------------

describe('canUploadVideo', () => {
  const STARTER_LIMIT = 100 * GiB // 107374182400

  it('allows upload when used + incoming is well under limit', () => {
    assert.equal(canUploadVideo(10 * GiB, 5 * GiB, STARTER_LIMIT), true)
  })

  it('allows upload when used + incoming equals limit exactly (boundary — true)', () => {
    // exactly at the cap: allowed (<=, not <)
    assert.equal(canUploadVideo(50 * GiB, 50 * GiB, STARTER_LIMIT), true)
    assert.equal(canUploadVideo(0, STARTER_LIMIT, STARTER_LIMIT), true)
  })

  it('blocks upload when used + incoming exceeds limit by 1 byte', () => {
    assert.equal(canUploadVideo(STARTER_LIMIT, 1, STARTER_LIMIT), false)
    assert.equal(canUploadVideo(50 * GiB, 50 * GiB + 1, STARTER_LIMIT), false)
  })

  it('blocks upload when already over limit', () => {
    assert.equal(canUploadVideo(STARTER_LIMIT + 1, 0, STARTER_LIMIT), false)
  })

  it('allows zero-byte upload at any used level', () => {
    assert.equal(canUploadVideo(STARTER_LIMIT, 0, STARTER_LIMIT), true)
  })
})

// ---------------------------------------------------------------------------
// invalidatePlanLimitCache
// ---------------------------------------------------------------------------

describe('invalidatePlanLimitCache', () => {
  it('deletes the agents cache key for the given agency', async () => {
    const cache = makeCache({ 'plan-limit:agency-1:agents': 3 })
    await invalidatePlanLimitCache(cache, 'agency-1')
    assert.equal(await cache.get('plan-limit:agency-1:agents'), null)
  })

  it('does not delete other agencies keys', async () => {
    const cache = makeCache({
      'plan-limit:agency-1:agents': 3,
      'plan-limit:agency-2:agents': 5,
    })
    await invalidatePlanLimitCache(cache, 'agency-1')
    assert.equal(await cache.get('plan-limit:agency-2:agents'), 5)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — cache hit
// ---------------------------------------------------------------------------

describe('checkPlanLimit — cache hit', () => {
  it('returns allowed=true when cached count is below limit', async () => {
    const agencyId = 'agency-cache-hit'
    // freemium limit=1; cache shows count=0 (below limit)
    const cache = makeCache({ [planLimitCacheKey(agencyId)]: 0 })
    const admin = makeAdminFull({ plan: 'freemium', count: 99 }) // DB count irrelevant

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, true)
    assert.equal(result.limit, 1)
    assert.equal(result.current, 0)
    // Seat count DB query was NOT called — cache hit served the value
    assert.equal(admin._tracker.countQueryCalled, 0)
  })

  it('returns allowed=false when cached count equals limit (at-limit blocks)', async () => {
    const agencyId = 'agency-at-limit'
    // starter limit=3; cache shows count=3
    const cache = makeCache({ [planLimitCacheKey(agencyId)]: 3 })
    const admin = makeAdminFull({ plan: 'starter', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 3)
    assert.equal(result.current, 3)
    assert.equal(admin._tracker.countQueryCalled, 0)
  })

  it('returns allowed=false when cached count exceeds limit', async () => {
    const agencyId = 'agency-over-limit'
    // studio limit=8; cache shows count=10 (over)
    const cache = makeCache({ [planLimitCacheKey(agencyId)]: 10 })
    const admin = makeAdminFull({ plan: 'studio', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 8)
    assert.equal(result.current, 10)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — starter: blocks 4th agent
// ---------------------------------------------------------------------------

describe('checkPlanLimit — starter plan gate', () => {
  it('blocks the 4th agent seat (current=3, limit=3)', async () => {
    const agencyId = 'agency-starter-full'
    const cache = makeCache() // empty, forces DB read
    const admin = makeAdminFull({ plan: 'starter', count: 3 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 3)
    assert.equal(result.current, 3)
  })

  it('allows the 3rd agent seat (current=2, limit=3)', async () => {
    const agencyId = 'agency-starter-room'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'starter', count: 2 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, true)
    assert.equal(result.limit, 3)
    assert.equal(result.current, 2)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — cache miss (DB read + cache populate)
// ---------------------------------------------------------------------------

describe('checkPlanLimit — cache miss', () => {
  it('reads DB and populates cache on cache miss', async () => {
    const agencyId = 'agency-cache-miss'
    const cache = makeCache() // empty cache
    const admin = makeAdminFull({ plan: 'starter', count: 1 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, true)
    assert.equal(result.current, 1)
    assert.equal(result.limit, 3)
    // DB count was called once
    assert.equal(admin._tracker.countQueryCalled, 1)
    // Cache was populated with the count
    const cached = await cache.get<number>(planLimitCacheKey(agencyId))
    assert.equal(cached, 1)
  })

  it('blocks when DB count equals limit', async () => {
    const agencyId = 'agency-miss-blocked'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'freemium', count: 1 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 1)
    assert.equal(result.current, 1)
  })

  it('respects higher plan limits', async () => {
    const agencyId = 'agency-pro'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'agency_pro', count: 15 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, true)
    assert.equal(result.limit, 20)
    assert.equal(result.current, 15)
  })

  it('calls cache.set with options.ex === PLAN_LIMIT_CACHE_TTL on cache miss + successful count', async () => {
    const agencyId = 'agency-ttl-check'
    const cache = makeCache() // empty — forces DB read
    const admin = makeAdminFull({ plan: 'starter', count: 2 })

    await checkPlanLimit(admin, cache, agencyId)

    assert.equal(cache.setCalls.length, 1)
    assert.equal(cache.setCalls[0].options.ex, PLAN_LIMIT_CACHE_TTL)
  })

  it('falls back to freemium limit when agency has no plan set', async () => {
    // admin returns null plan → falls back to freemium (1 seat)
    const agencyId = 'agency-no-plan'
    const cache = makeCache()
    // Simulate agencies query returning data: null (no plan column)
    const clientNoData = {
      _tracker: { agencyQueryCalled: 0, countQueryCalled: 0 },
      from(table: string) {
        if (table === 'agencies') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: null, error: null }),
              }),
            }),
          }
        }
        if (table === 'memberships') {
          return {
            select: () => {
              const self: Record<string, unknown> = {}
              self['eq'] = () => self
              self['in'] = () => Promise.resolve({ count: 0, error: null })
              return self
            },
          }
        }
        return {}
      },
    } as unknown as SupabaseClient & {
      _tracker: { agencyQueryCalled: number; countQueryCalled: number }
    }

    const result = await checkPlanLimit(clientNoData, cache, agencyId)
    // freemium fallback: limit=1, current=0
    assert.equal(result.limit, 1)
    assert.equal(result.allowed, true)
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
      () => checkPlanLimit(admin, cache, agencyId),
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
      await checkPlanLimit(admin, cache, agencyId)
    } catch {
      // expected — fail-closed
    }

    assert.equal(cache.setCalls.length, 0)
  })

  it('PlanLimitUnavailableError has the correct name', async () => {
    const cache = makeCache()
    const admin = makeAdminFull({
      plan: 'freemium',
      countError: { message: 'error' },
    })

    let caught: unknown
    try {
      await checkPlanLimit(admin, cache, 'agency-err-name')
    } catch (err) {
      caught = err
    }

    assert.ok(caught instanceof PlanLimitUnavailableError)
    assert.equal((caught as PlanLimitUnavailableError).name, 'PlanLimitUnavailableError')
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — fail-closed on agency plan-resolution error
// ---------------------------------------------------------------------------

describe('checkPlanLimit — fail-closed on agency query error', () => {
  it('throws PlanLimitUnavailableError instead of silently defaulting to freemium', async () => {
    // If the agencies query fails, the gate must NOT fall back to freemium
    // limits — that would wrongly deny seats to a paying customer. Fail closed.
    const cache = makeCache()
    const admin = makeAdminFull({
      agencyError: { message: 'connection refused', code: 'PGRST000' },
    })

    await assert.rejects(
      () => checkPlanLimit(admin, cache, 'agency-plan-query-error'),
      (err: unknown) => err instanceof PlanLimitUnavailableError
    )
  })

  it('does NOT count seats or populate cache when the agency query errors', async () => {
    const cache = makeCache()
    const admin = makeAdminFull({
      agencyError: { message: 'timeout' },
    })

    try {
      await checkPlanLimit(admin, cache, 'agency-plan-query-error-no-cache')
    } catch {
      // expected — fail-closed
    }

    assert.equal(admin._tracker.countQueryCalled, 0)
    assert.equal(cache.setCalls.length, 0)
  })
})

// ---------------------------------------------------------------------------
// checkPlanLimit — result shape
// ---------------------------------------------------------------------------

describe('checkPlanLimit — result shape', () => {
  it('returns numeric limit and current when blocked', async () => {
    const agencyId = 'agency-exact-shape'
    // studio limit=8; cache shows count=8
    const cache = makeCache({ [planLimitCacheKey(agencyId)]: 8 })
    const admin = makeAdminFull({ plan: 'studio', count: 99 })

    const result = await checkPlanLimit(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(typeof result.limit, 'number')
    assert.equal(typeof result.current, 'number')
    assert.equal(result.limit, 8)
    assert.equal(result.current, 8)
  })
})

// ---------------------------------------------------------------------------
// canAddAgent (thin wrapper over checkPlanLimit)
// ---------------------------------------------------------------------------

describe('canAddAgent', () => {
  it('returns same result as checkPlanLimit (allowed=true)', async () => {
    const agencyId = 'agency-can-add'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'studio', count: 5 })

    const result = await canAddAgent(admin, cache, agencyId)

    assert.equal(result.allowed, true)
    assert.equal(result.limit, 8)
    assert.equal(result.current, 5)
  })

  it('returns same result as checkPlanLimit (allowed=false at limit)', async () => {
    const agencyId = 'agency-cant-add'
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'starter', count: 3 })

    const result = await canAddAgent(admin, cache, agencyId)

    assert.equal(result.allowed, false)
    assert.equal(result.limit, 3)
  })

  it('throws PlanLimitUnavailableError on count failure', async () => {
    const cache = makeCache()
    const admin = makeAdminFull({ plan: 'starter', countError: { message: 'err' } })

    await assert.rejects(
      () => canAddAgent(admin, cache, 'agency-wrapper-err'),
      (err: unknown) => err instanceof PlanLimitUnavailableError
    )
  })
})

// ---------------------------------------------------------------------------
// isGracePeriodExpired
// ---------------------------------------------------------------------------

describe('isGracePeriodExpired', () => {
  const PAST_DUE_STATUS = 'past_due'
  const ACTIVE_STATUS = 'active'

  it('returns false when subscriptionStatus is not past_due (active)', () => {
    const expired = isGracePeriodExpired({
      subscriptionStatus: ACTIVE_STATUS,
      gracePeriodEndsAt: '2020-01-01T00:00:00.000Z', // long past
    })
    assert.equal(expired, false)
  })

  it('returns false when subscriptionStatus is not past_due (trialing)', () => {
    const expired = isGracePeriodExpired({
      subscriptionStatus: 'trialing',
      gracePeriodEndsAt: '2020-01-01T00:00:00.000Z',
    })
    assert.equal(expired, false)
  })

  it('returns false when subscriptionStatus is not past_due (null)', () => {
    const expired = isGracePeriodExpired({
      subscriptionStatus: null,
      gracePeriodEndsAt: '2020-01-01T00:00:00.000Z',
    })
    assert.equal(expired, false)
  })

  it('returns false when gracePeriodEndsAt is null (no grace window recorded)', () => {
    const expired = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt: null,
    })
    assert.equal(expired, false)
  })

  it('returns true when past_due AND grace window has elapsed', () => {
    // Grace window ended 1 second ago
    const past = new Date(Date.now() - 1000).toISOString()
    const expired = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt: past,
    })
    assert.equal(expired, true)
  })

  it('returns false when past_due BUT still within the grace window', () => {
    // Grace window ends in the future
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const expired = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt: future,
    })
    assert.equal(expired, false)
  })

  it('accepts an injected now date for deterministic testing', () => {
    const gracePeriodEndsAt = '2025-01-10T00:00:00.000Z'
    // now is before the grace end → still within window
    const withinWindow = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt,
      now: new Date('2025-01-09T23:59:59.000Z'),
    })
    assert.equal(withinWindow, false)

    // now is after the grace end → expired
    const afterWindow = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt,
      now: new Date('2025-01-10T00:00:01.000Z'),
    })
    assert.equal(afterWindow, true)
  })

  it('returns false when now equals grace end exactly (boundary: not strictly greater)', () => {
    const gracePeriodEndsAt = '2025-06-01T12:00:00.000Z'
    const expired = isGracePeriodExpired({
      subscriptionStatus: PAST_DUE_STATUS,
      gracePeriodEndsAt,
      now: new Date(gracePeriodEndsAt), // exactly at boundary
    })
    // new Date(x) > new Date(x) is false — so boundary is not expired
    assert.equal(expired, false)
  })
})
