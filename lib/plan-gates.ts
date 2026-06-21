/**
 * lib/plan-gates.ts
 *
 * Agent-seat plan gate. Talent is unlimited and never metered.
 *
 * Architecture:
 * - All limit numbers come from `lib/plans.ts` (the single source of truth).
 *   There is no PLAN_LIMITS map here — `getAgentSeatLimit(plan)` from plans.ts
 *   is used at check-time.
 * - The gate counts owner + admin_agent + agent roles (non-talent seats).
 * - Talent seats are NOT gated; callers that previously passed category:'talent'
 *   should simply omit the gate call.
 * - Counts are cached in Redis with a TTL ≤60s to avoid hot-path DB reads on every add.
 *   Cache key: `plan-limit:{agencyId}:agents`.
 * - On a successful add, invalidatePlanLimitCache() removes the stale key.
 *   Plan-change and member-remove handlers MUST also call invalidatePlanLimitCache()
 *   (those routes are out of scope for this PR — see follow-up task).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getAgentSeatLimit } from '@/lib/plans'

// ---------------------------------------------------------------------------
// Re-exports from plans.ts (single source of truth for all tier numbers)
// ---------------------------------------------------------------------------

export { getPlan, getStorageLimitBytes, getAgentSeatLimit } from '@/lib/plans'

// ---------------------------------------------------------------------------
// Grace-period helper
// ---------------------------------------------------------------------------

/**
 * Returns true when a past_due agency's grace window has expired.
 *
 * Semantics:
 *   - `subscriptionStatus !== 'past_due'` → false (not past due, no block)
 *   - `gracePeriodEndsAt === null`         → false (no grace window recorded yet)
 *   - `now <= gracePeriodEndsAt`           → false (still inside the grace window)
 *   - `now > gracePeriodEndsAt`            → true  (window elapsed, block the action)
 *
 * Pure and synchronous — no side-effects, fully unit-testable without mocks.
 *
 * @param args.subscriptionStatus - agencies.subscription_status value (or null).
 * @param args.gracePeriodEndsAt  - agencies.grace_period_ends_at ISO string (or null).
 * @param args.now                - Current time (defaults to new Date()). Inject in tests.
 */
export function isGracePeriodExpired({
  subscriptionStatus,
  gracePeriodEndsAt,
  now = new Date(),
}: {
  subscriptionStatus: string | null
  gracePeriodEndsAt: string | null
  now?: Date
}): boolean {
  if (subscriptionStatus !== 'past_due') return false
  if (!gracePeriodEndsAt) return false
  return now > new Date(gracePeriodEndsAt)
}

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

export function planLimitCacheKey(agencyId: string): string {
  return `plan-limit:${agencyId}:agents`
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
 * Thrown by checkPlanLimit when the seat count query fails and the gate
 * cannot be evaluated. Callers should return HTTP 503 (service unavailable).
 */
export class PlanLimitUnavailableError extends Error {
  constructor(cause: unknown) {
    super('[plan-gates] Seat count unavailable — denying add (fail closed)')
    this.name = 'PlanLimitUnavailableError'
    if (cause instanceof Error) this.cause = cause
  }
}

/**
 * Count current agent seats for an agency.
 * Uses the admin client so RLS doesn't filter rows.
 * Returns null on error (caller must fail closed — do NOT cache null).
 */
async function countSeats(admin: SupabaseClient, agencyId: string): Promise<number | null> {
  const { count, error } = await admin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .in('role', [...AGENT_SEAT_ROLES])

  if (error) {
    console.error('[plan-gates] countSeats error:', error)
    return null
  }
  return count ?? 0
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** TTL for cached seat counts (seconds). Must be ≤60. */
export const PLAN_LIMIT_CACHE_TTL = 60

/**
 * Check whether adding one more agent seat is within the agency's plan limit.
 *
 * Uses the cache client for a hot-path read; falls back to DB on cache miss.
 * Reads the agency's `plan` column (admin client, bypasses RLS) to resolve
 * the seat limit via `getAgentSeatLimit` from lib/plans.ts.
 *
 * @param admin    - Service-role Supabase client (bypasses RLS for count + plan reads).
 * @param cache    - Redis-compatible cache client (injected to avoid top-level import).
 * @param agencyId - UUID of the agency being checked.
 */
export async function checkPlanLimit(
  admin: SupabaseClient,
  cache: CacheClient,
  agencyId: string
): Promise<GateResult> {
  // Resolve the agency's plan and derive the seat limit.
  // Fail closed: a query error (network, RLS) must NOT silently fall back to
  // freemium limits — that would wrongly deny seats to a paying customer.
  const { data, error } = await admin.from('agencies').select('plan').eq('id', agencyId).single()
  if (error) {
    // Same fail-closed contract as countSeats → 503 at the caller.
    throw new PlanLimitUnavailableError(error)
  }
  const plan: string = (data as { plan?: string } | null)?.plan ?? 'freemium'
  const limit = getAgentSeatLimit(plan)

  const cacheKey = planLimitCacheKey(agencyId)
  let current: number

  // Cache hit
  const cached = await cache.get<number>(cacheKey)
  if (cached !== null && cached !== undefined) {
    current = Number(cached)
  } else {
    // Cache miss — read from DB and populate cache
    const counted = await countSeats(admin, agencyId)
    if (counted === null) {
      // Count failed — fail CLOSED. Do NOT cache the error value.
      throw new PlanLimitUnavailableError(
        new Error(`countSeats returned null for agency ${agencyId}`)
      )
    }
    current = counted
    await cache.set(cacheKey, current, { ex: PLAN_LIMIT_CACHE_TTL })
  }

  return { allowed: current < limit, limit, current }
}

/**
 * Invalidate the cached agent seat count for an agency.
 * Call this after a successful member add or remove, and on plan change.
 */
export async function invalidatePlanLimitCache(
  cache: CacheClient,
  agencyId: string
): Promise<void> {
  await cache.del(planLimitCacheKey(agencyId))
}

/**
 * Convenience wrapper: check whether one more agent seat can be added.
 * Delegates entirely to checkPlanLimit — same fail-closed semantics.
 *
 * @param admin    - Service-role Supabase client.
 * @param cache    - Redis-compatible cache client.
 * @param agencyId - UUID of the agency being checked.
 */
export async function canAddAgent(
  admin: SupabaseClient,
  cache: CacheClient,
  agencyId: string
): Promise<GateResult> {
  return checkPlanLimit(admin, cache, agencyId)
}

/**
 * Pure helper: returns true if uploading `incomingBytes` would keep the
 * agency within its storage cap.
 *
 * The caller is responsible for supplying the correct `storageLimitBytes`
 * (e.g. from `getStorageLimitBytes(plan)` or the agencies.storage_limit_bytes column).
 * This function performs no DB or cache access.
 *
 * @param usedBytes          - Current bytes consumed by the agency.
 * @param incomingBytes      - Size of the file about to be uploaded.
 * @param storageLimitBytes  - The agency's storage cap in bytes.
 */
export function canUploadVideo(
  usedBytes: number,
  incomingBytes: number,
  storageLimitBytes: number
): boolean {
  return usedBytes + incomingBytes <= storageLimitBytes
}
