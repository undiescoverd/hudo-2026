/**
 * PATCH /api/agencies/[id]/members/[userId]/billing-access   body: { enabled: boolean }
 *
 * Owner grants or revokes billing access (memberships.can_manage_billing) for ONE
 * admin agent. Per person; never a role change. S5-ADMIN-001, GH #207.
 *
 * Security:
 * - Authenticated users only (401)
 * - Caller must be an owner of this agency, read fresh from memberships (403)
 * - Target must be an admin_agent member of the same agency (404 unknown, 400 other role)
 * - Rate-limited: 20 requests / 60s per agency, after authorization
 * - The grant/revoke is written to audit_log and the insert is awaited
 * - memberships has no client write policy and a trigger blocks client roles from
 *   the column (0033); the write goes through the service-role client only
 */

import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit, requireMembership } from '@/lib/api-helpers'
import { canGrantBillingAccess, isBillingGrantTarget } from '@/lib/billing-access'
import { logEvent } from '@/lib/audit'

const RATE_LIMIT = 20
const RATE_WINDOW = 60 // seconds

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string; userId: string } }
) {
  const { id: agencyId, userId: targetUserId } = params

  if (!isValidUUID(agencyId) || !isValidUUID(targetUserId)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[billing-access:PATCH] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Caller must be an owner of THIS agency (fresh read; DB error -> 500, none -> 403).
  const caller = await requireMembership(admin, user.id, agencyId)
  if (caller instanceof NextResponse) return caller
  if (!canGrantBillingAccess(caller.role)) {
    return NextResponse.json({ error: 'Access denied — owner role required' }, { status: 403 })
  }

  // Rate limit AFTER authorization so an outsider cannot burn the agency's limit.
  const rateLimitResponse = await checkRateLimit(
    `billing-access:agency:${agencyId}`,
    RATE_LIMIT,
    RATE_WINDOW,
    'agencies/[id]/members/[userId]/billing-access:PATCH',
    'Too many requests'
  )
  if (rateLimitResponse) return rateLimitResponse

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
  }

  // Target must be a member of this agency, and an admin agent.
  const { data: target, error: targetError } = await admin
    .from('memberships')
    .select('id, role, can_manage_billing')
    .eq('user_id', targetUserId)
    .eq('agency_id', agencyId)
    .maybeSingle()
  if (targetError) {
    console.error('[billing-access:PATCH] Target lookup failed:', targetError.message)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (!isBillingGrantTarget(target.role)) {
    return NextResponse.json(
      { error: 'Billing access can only be given to admin agents' },
      { status: 400 }
    )
  }

  if (target.can_manage_billing !== enabled) {
    // Role is re-asserted in the filter so a concurrent demotion cannot slip through.
    const { data: updated, error: updateError } = await admin
      .from('memberships')
      .update({ can_manage_billing: enabled })
      .eq('id', target.id)
      .eq('role', 'admin_agent')
      .select('id')
    if (updateError) {
      console.error('[billing-access:PATCH] Update failed:', updateError.message)
      return NextResponse.json({ error: 'Failed to update billing access' }, { status: 500 })
    }
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const actorName =
      typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
        ? user.user_metadata.full_name.trim()
        : (user.email ?? user.id)

    // Awaited: the grant/revoke trail must exist before we report success.
    await logEvent({
      action: enabled ? 'billing_access_granted' : 'billing_access_revoked',
      resourceType: 'membership',
      resourceId: target.id,
      agencyId,
      actorId: user.id,
      actorName,
      metadata: { target_user_id: targetUserId },
    })
  }

  return NextResponse.json({ userId: targetUserId, canManageBilling: enabled }, { status: 200 })
}
