import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent'] as const

/**
 * Rate-limit failure posture, per endpoint class:
 * - 'fail-open' (default): authenticated data reads/writes (dashboards, comments,
 *   notifications, video metadata). Availability during a brief Redis outage matters
 *   more than the marginal abuse risk from a short unlimited window — the request is
 *   allowed through and the failure is logged.
 * - 'fail-closed': unauthenticated or high-abuse-value endpoints (auth signin/register/
 *   reset-password, invitation send/accept/validate). These gate account creation,
 *   credential guessing, and email-enumeration surfaces — an attacker who can force a
 *   Redis outage must not be handed unlimited attempts. On a Redis error the request is
 *   rejected with 503 (distinct from 429, which means the limit was actually exceeded)
 *   so clients back off and retry rather than silently bypassing the limit.
 */
export type RateLimitMode = 'fail-open' | 'fail-closed'

/** Retry-After (seconds) returned when fail-closed rejects a request due to a Redis error. */
export const RATE_LIMIT_FAIL_CLOSED_RETRY_AFTER = 30

export async function checkRateLimit(
  key: string,
  limit: number,
  window: number,
  context: string,
  errorMessage: string,
  mode: RateLimitMode = 'fail-open'
): Promise<NextResponse | null> {
  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(key, limit, window)
    if (remaining === -1) {
      return NextResponse.json(
        { error: errorMessage },
        { status: 429, headers: { 'Retry-After': String(window) } }
      )
    }
    return null
  } catch (err) {
    if (mode === 'fail-closed') {
      return rateLimitFailClosedResponse(context, err)
    }
    console.error(`[${context}] Rate limit check failed, allowing request:`, err)
    return null
  }
}

/**
 * Shared 503 response for the fail-closed posture — used both by checkRateLimit's
 * catch branch and by call sites (e.g. dual-key auth rate limiting) that can't route
 * through checkRateLimit directly.
 */
export function rateLimitFailClosedResponse(context: string, err: unknown): NextResponse {
  console.error(`[${context}] Rate limit check failed, failing closed:`, err)
  return NextResponse.json(
    { error: 'Service temporarily unavailable. Please try again shortly.' },
    {
      status: 503,
      headers: { 'Retry-After': String(RATE_LIMIT_FAIL_CLOSED_RETRY_AFTER) },
    }
  )
}

export async function requireMembership(
  admin: SupabaseClient,
  userId: string,
  agencyId: string
): Promise<{ role: string } | NextResponse> {
  const { data: membership, error } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('agency_id', agencyId)
    .single()
  // PGRST116 = "Results contain 0 rows" — legitimate auth failure, return 403.
  // Any other error is an unexpected server-side failure — log and return 500.
  if (error && error.code !== 'PGRST116') {
    console.error('[api-helpers] Membership query failed:', error.message)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  return membership as { role: string }
}

export async function requireAgentRole(
  admin: SupabaseClient,
  userId: string,
  agencyId: string,
  actionMessage: string
): Promise<{ role: string } | NextResponse> {
  const result = await requireMembership(admin, userId, agencyId)
  if (result instanceof NextResponse) return result
  if (!AGENT_PLUS_ROLES.includes(result.role as (typeof AGENT_PLUS_ROLES)[number])) {
    return NextResponse.json({ error: actionMessage }, { status: 403 })
  }
  return result
}
