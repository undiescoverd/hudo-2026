/**
 * lib/plan-gates.ts
 *
 * Agent and talent seat plan gates.
 *
 * Architecture:
 * - PLAN_LIMITS is a static config map keyed by agency plan name.
 *   There is no `plans` DB table — limits are code-defined and intentionally
 *   kept here for a single place to update (or replace with remote config later).
 * - The "agents" category counts owner + admin_agent + agent roles (non-talent seats).
 * - The "talent" category counts the 'talent' role only.
 * - Counts are cached in Redis with a TTL ≤60s to avoid hot-path DB reads on every add.
 *   Cache key: `plan-limit:{agencyId}:agents` or `plan-limit:{agencyId}:talent`.
 * - On a successful add, invalidatePlanLimitCache() removes the stale key.
 *   Plan-change and member-remove handlers MUST also call invalidatePlanLimitCache()
 *   (those routes are out of scope for this PR — see follow-up task).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Plan limits config
// ---------------------------------------------------------------------------

export type MemberCategory = 'agents' | 'talent'

export interface PlanLimits {
  /** Max seats for owner + admin_agent + agent combined. */
  agents: number
  /** Max seats for the talent role. */
  talent: number
}

/**
 * Static seat limits per plan.
 * These are intentionally configurable here — swap for DB/remote config later.
 */
export const PLAN_LIMITS: Record<string, PlanLimits> = {
  freemium: { agents: 5, talent: 10 },
  starter: { agents: 10, talent: 25 },
  studio: { agents: 25, talent: 75 },
  agency_pro: { agents: 100, talent: 300 },
}

/** Fallback for unknown plan strings. */
const DEFAULT_LIMITS: PlanLimits = PLAN_LIMITS.freemium

/** Roles counted in the "agents" category. */
export const AGENT_SEAT_ROLES = ['owner', 'admin_agent', 'agent'] as const

// ---------------------------------------------------------------------------
// Cache client interface (dependency-injected to avoid top-level redis import)
// ---------------------------------------------------------------------------

/**
 * Minimal cache interface accepted by plan-gate helpers.
 * In production, pass the Upstash `redis` singleton from lib/redis.ts.
 * In tests, pass a simple in-memory mock.
 */
export interface CacheClient {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown, options: { ex: number }): Promise<unknown>
  del(key: string): Promise<unknown>
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

export function planLimitCacheKey(agencyId: string, category: MemberCategory): string {
  return `plan-limit:${agencyId}:${category}`
}

// ---------------------------------------------------------------------------
// Gate check result
// ---------------------------------------------------------------------------

export interface GateResult {
  allowed: boolean
  limit: number
  current: number
}

// ---------------------------------------------------------------------------
// Core gate logic
// ---------------------------------------------------------------------------

/**
 * Resolve limits for an agency by reading its plan from the DB.
 * Uses the admin (service-role) Supabase client so RLS doesn't filter the row.
 */
async function getAgencyLimits(admin: SupabaseClient, agencyId: string): Promise<PlanLimits> {
  const { data } = await admin.from('agencies').select('plan').eq('id', agencyId).single()

  const plan: string = (data as { plan?: string } | null)?.plan ?? 'freemium'
  return PLAN_LIMITS[plan] ?? DEFAULT_LIMITS
}

/**
 * Count current seats in a category for an agency.
 * Uses the admin client so RLS doesn't filter rows.
 * Returns 0 on error (fail-open on count — the insert will still be RLS-guarded).
 */
async function countSeats(
  admin: SupabaseClient,
  agencyId: string,
  category: MemberCategory
): Promise<number> {
  let query = admin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)

  if (category === 'agents') {
    query = query.in('role', [...AGENT_SEAT_ROLES])
  } else {
    query = query.eq('role', 'talent')
  }

  const { count, error } = await query
  if (error) {
    console.error('[plan-gates] countSeats error:', error)
    return 0
  }
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** TTL for cached seat counts (seconds). Must be ≤60. */
export const PLAN_LIMIT_CACHE_TTL = 60

/**
 * Check whether adding one more seat in `category` is within the agency's plan limit.
 *
 * Uses the cache client for a hot-path read; falls back to DB on cache miss.
 *
 * @param admin    - Service-role Supabase client (bypasses RLS for count + plan reads).
 * @param cache    - Redis-compatible cache client (injected to avoid top-level import).
 * @param agencyId - UUID of the agency being checked.
 * @param category - 'agents' or 'talent'.
 */
export async function checkPlanLimit(
  admin: SupabaseClient,
  cache: CacheClient,
  agencyId: string,
  category: MemberCategory
): Promise<GateResult> {
  const limits = await getAgencyLimits(admin, agencyId)
  const limit = limits[category]

  const cacheKey = planLimitCacheKey(agencyId, category)
  let current: number

  // Cache hit
  const cached = await cache.get<number>(cacheKey)
  if (cached !== null && cached !== undefined) {
    current = Number(cached)
  } else {
    // Cache miss — read from DB and populate cache
    current = await countSeats(admin, agencyId, category)
    await cache.set(cacheKey, current, { ex: PLAN_LIMIT_CACHE_TTL })
  }

  return { allowed: current < limit, limit, current }
}

/**
 * Invalidate the cached seat count for a given agency + category.
 * Call this after a successful member add or remove, and on plan change.
 */
export async function invalidatePlanLimitCache(
  cache: CacheClient,
  agencyId: string,
  category: MemberCategory
): Promise<void> {
  await cache.del(planLimitCacheKey(agencyId, category))
}
