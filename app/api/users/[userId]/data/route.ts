import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import { DELETED_USER_NAME, eraseUser } from '@/lib/erasure'
import { logEvent } from '@/lib/audit'

/**
 * DELETE /api/users/:userId/data
 *
 * GDPR right-to-erasure (S3-COMPLY-002). Tombstones the target user's
 * personal data, scrubs their identity from the audit trail, removes their
 * per-user rows, and revokes every Supabase auth session — see lib/erasure.ts
 * for the exact steps and why the users row is UPDATEd rather than DELETEd.
 *
 * Authorization (no user enumeration — a generic 403 is returned before any
 * existence check):
 * - Self-erasure is always allowed.
 * - Otherwise the caller must hold owner | admin_agent in at least one
 *   agency the target belongs to, AND that role must outrank the target's
 *   role in that same agency: owner may erase anyone; admin_agent may only
 *   erase agent | talent targets (anti-escalation — an admin_agent must
 *   never be able to erase an owner or another admin_agent).
 * - Sole-owner guard: if the target is the sole 'owner' of ANY agency,
 *   erasure is refused with 409 — the agency would be left ownerless. This
 *   applies to self-erasure too (an owner must transfer/add another owner
 *   first).
 *
 * Residual risk (D1): revoking the Supabase auth user invalidates refresh
 * tokens immediately, but an access JWT already issued to the target stays
 * cryptographically valid for up to its TTL (<=1h). This is not a data leak
 * in practice: memberships are deleted before the auth revocation runs, so
 * requireMembership()/requireAgentRole() already 403 every membership-scoped
 * route for that JWT regardless of whether it has expired yet.
 */
const ERASURE_RATE_LIMIT = 5
const ERASURE_RATE_WINDOW = 3600 // seconds (1 hour)

export async function DELETE(request: NextRequest, { params }: { params: { userId: string } }) {
  const targetUserId = params.userId

  if (!isValidUUID(targetUserId)) {
    return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[users/[userId]/data:DELETE] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // ---- User auth (cookie-scoped client) ------------------------------------
  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // ---- Rate limit — fail-closed: this is a destructive, high-abuse-value
  // endpoint, so a Redis outage must not hand out unlimited erasure attempts.
  const rateLimitResponse = await checkRateLimit(
    `erasure:user:${user.id}`,
    ERASURE_RATE_LIMIT,
    ERASURE_RATE_WINDOW,
    'users/[userId]/data:DELETE',
    'Too many erasure requests. Please try again later.',
    'fail-closed'
  )
  if (rateLimitResponse) return rateLimitResponse

  // ---- Admin client (service-role, bypasses RLS) ---------------------------
  const admin = createAdminClient()

  const isSelf = user.id === targetUserId

  // ---- Fetch the target's memberships — needed for both the authz check
  // (non-self) and the sole-owner guard (both self and non-self). An empty
  // result is valid (a user may belong to zero agencies, or may not exist).
  const { data: targetMemberships, error: targetMembershipsError } = await admin
    .from('memberships')
    .select('agency_id, role')
    .eq('user_id', targetUserId)

  if (targetMembershipsError) {
    console.error(
      '[users/[userId]/data:DELETE] Failed to load target memberships:',
      targetMembershipsError.message
    )
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  // ---- Authz (403) — must run before any existence disclosure, so a
  // nonexistent target and an unauthorized target both fall through to the
  // same generic 403 below (targetMemberships is [] either way).
  if (!isSelf) {
    const { data: callerMemberships, error: callerMembershipsError } = await admin
      .from('memberships')
      .select('agency_id, role')
      .eq('user_id', user.id)

    if (callerMembershipsError) {
      console.error(
        '[users/[userId]/data:DELETE] Failed to load caller memberships:',
        callerMembershipsError.message
      )
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    const callerRoleByAgency = new Map(
      (callerMemberships ?? []).map((m) => [m.agency_id as string, m.role as string])
    )

    const authorized = (targetMemberships ?? []).some((tm) => {
      const callerRole = callerRoleByAgency.get(tm.agency_id as string)
      if (callerRole === 'owner') return true
      if (callerRole === 'admin_agent' && (tm.role === 'agent' || tm.role === 'talent')) {
        return true
      }
      return false
    })

    if (!authorized) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  // ---- Sole-owner guard (409) — applies to self-erasure too. An agency must
  // never be left without an owner.
  const ownerAgencyIds = (targetMemberships ?? [])
    .filter((m) => m.role === 'owner')
    .map((m) => m.agency_id as string)

  for (const agencyId of ownerAgencyIds) {
    const { count, error: ownerCountError } = await admin
      .from('memberships')
      .select('*', { count: 'exact', head: true })
      .eq('agency_id', agencyId)
      .eq('role', 'owner')

    if (ownerCountError) {
      console.error(
        '[users/[userId]/data:DELETE] Failed to count agency owners:',
        ownerCountError.message
      )
      return NextResponse.json({ error: 'Server error' }, { status: 500 })
    }

    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: 'sole_owner' }, { status: 409 })
    }
  }

  // ---- Target existence (404) — only checked after authz passes, so an
  // unauthorized caller learns nothing about whether the target exists.
  const { data: targetUser, error: targetUserError } = await admin
    .from('users')
    .select('id')
    .eq('id', targetUserId)
    .single()

  if (targetUserError && targetUserError.code !== 'PGRST116') {
    console.error(
      '[users/[userId]/data:DELETE] Failed to look up target user:',
      targetUserError.message
    )
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  if (!targetUser) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // ---- Erase -----------------------------------------------------------
  const result = await eraseUser(admin, targetUserId)

  if (!result.ok) {
    console.error(
      `[users/[userId]/data:DELETE] Erasure failed at step "${result.step}":`,
      result.message
    )
    return NextResponse.json({ error: 'Erasure failed', step: result.step }, { status: 500 })
  }

  // ---- Audit: fire-and-forget, one event per agency the target belonged
  // to. Self-erasure uses a null actor + the same "Deleted User" name the
  // tombstone just wrote — logging the caller's real identity here would
  // re-introduce the PII that was just scrubbed.
  const actorId = isSelf ? null : user.id
  const actorName = isSelf
    ? DELETED_USER_NAME
    : typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)

  for (const agencyId of result.agencyIds) {
    logEvent({
      action: 'user_erased',
      resourceType: 'user',
      resourceId: targetUserId,
      agencyId,
      actorId,
      actorName,
    }).catch((err) => console.error('[users/[userId]/data] logEvent unhandled rejection:', err))
  }

  return NextResponse.json({ success: true }, { status: 200 })
}
