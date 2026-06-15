/**
 * POST /api/agencies/[id]/members
 *
 * Adds a new agent-role member (owner | admin_agent | agent) to an agency.
 * Checks the plan seat limit before inserting.
 *
 * Security:
 * - Authenticated users only (401)
 * - Caller must hold owner | admin_agent role in the target agency (403)
 * - Seat limit checked against plan — 402 on overflow
 * - Rate-limited: 20 requests / 60s per agency
 */

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import {
  checkPlanLimit,
  invalidatePlanLimitCache,
  PlanLimitUnavailableError,
} from '@/lib/plan-gates'

const ALLOWED_MEMBER_ROLES = ['owner', 'admin_agent', 'agent'] as const
type AllowedMemberRole = (typeof ALLOWED_MEMBER_ROLES)[number]

// Roles that may add agent-role members (owner and admin_agent only)
const ADD_MEMBER_ROLES = new Set(['owner', 'admin_agent'])

const MEMBERS_RATE_LIMIT = 20
const MEMBERS_RATE_WINDOW = 60 // seconds

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const agencyId = params.id

  if (!isValidUUID(agencyId)) {
    return NextResponse.json({ error: 'Invalid agency ID' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[agencies/[id]/members:POST] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // ---- User auth (cookie-scoped client) ------------------------------------
  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options)
        }
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ---- Rate limit ----------------------------------------------------------
  const rateLimitResponse = await checkRateLimit(
    `members:post:agency:${agencyId}`,
    MEMBERS_RATE_LIMIT,
    MEMBERS_RATE_WINDOW,
    'agencies/[id]/members:POST',
    'Too many requests'
  )
  if (rateLimitResponse) return rateLimitResponse

  // ---- Admin client (service-role, bypasses RLS) ---------------------------
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ---- Caller authz: must be owner or admin_agent in this agency -----------
  const { data: callerMembership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .single()

  if (!callerMembership || !ADD_MEMBER_ROLES.has(callerMembership.role)) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // ---- Parse body ----------------------------------------------------------
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Request body must be an object' }, { status: 400 })
  }

  const b = body as Record<string, unknown>

  if (typeof b.user_id !== 'string' || !isValidUUID(b.user_id)) {
    return NextResponse.json({ error: 'user_id must be a valid UUID' }, { status: 400 })
  }

  if (typeof b.role !== 'string' || !ALLOWED_MEMBER_ROLES.includes(b.role as AllowedMemberRole)) {
    return NextResponse.json(
      { error: `role must be one of: ${ALLOWED_MEMBER_ROLES.join(', ')}` },
      { status: 400 }
    )
  }

  const newUserId = b.user_id
  const newRole = b.role as AllowedMemberRole

  // ---- Plan gate -----------------------------------------------------------
  const { redis } = await import('@/lib/redis')

  let gate: Awaited<ReturnType<typeof checkPlanLimit>>
  try {
    gate = await checkPlanLimit(admin, redis, agencyId, 'agents')
  } catch (err) {
    if (err instanceof PlanLimitUnavailableError) {
      console.error('[agencies/[id]/members:POST] Plan gate unavailable:', err)
      return NextResponse.json({ error: 'seat_count_unavailable' }, { status: 503 })
    }
    throw err
  }
  if (!gate.allowed) {
    return NextResponse.json(
      { error: 'plan_limit_exceeded', limit: gate.limit, current: gate.current },
      { status: 402 }
    )
  }

  // ---- Insert membership ---------------------------------------------------
  const { data: newMembership, error: insertError } = await admin
    .from('memberships')
    .insert({ user_id: newUserId, agency_id: agencyId, role: newRole })
    .select()
    .single()

  if (insertError) {
    // 23505 = unique_violation (user already a member)
    if (insertError.code === '23505') {
      return NextResponse.json(
        { error: 'User is already a member of this agency' },
        { status: 409 }
      )
    }
    console.error('[agencies/[id]/members:POST] Insert failed:', insertError)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }

  // ---- Invalidate cache after successful add --------------------------------
  await invalidatePlanLimitCache(redis, agencyId, 'agents')

  return NextResponse.json({ membership: newMembership }, { status: 201 })
}
