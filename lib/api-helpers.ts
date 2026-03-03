import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const AGENT_PLUS_ROLES = ['owner', 'admin_agent', 'agent'] as const

export async function checkRateLimit(
  key: string,
  limit: number,
  window: number,
  context: string,
  errorMessage: string
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
  } catch (err) {
    console.error(`[${context}] Rate limit check failed, allowing request:`, err)
  }
  return null
}

export async function requireMembership(
  admin: SupabaseClient,
  userId: string,
  agencyId: string
): Promise<{ role: string } | NextResponse> {
  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('agency_id', agencyId)
    .single()
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
