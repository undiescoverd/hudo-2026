import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'
import { checkRateLimit } from '@/lib/api-helpers'
import {
  DELETED_USER_NAME,
  canEraseUser,
  eraseUser,
  removeMemberWithData,
  sendErasureEmails,
} from '@/lib/erasure'
import { logEvent } from '@/lib/audit'

/**
 * DELETE /api/users/:userId/data
 *
 * GDPR right-to-erasure (S3-COMPLY-002). Tombstones the target user's
 * personal data, scrubs their identity from the audit trail, removes their
 * per-user rows, and revokes every Supabase auth session — see lib/erasure.ts
 * for the exact steps and why the users row is UPDATEd rather than DELETEd.
 *
 * Scope (S4-ERASE-001, D13):
 * - Self-erasure (caller === target) erases everything, everywhere: the
 *   talent's videos in every agency (purge_talent_in_agency), then the account.
 * - Anyone else MUST pass `?agencyId=` (400 otherwise). The removal is scoped
 *   to THAT agency only: the target's videos there and their membership are
 *   deleted; the account is erased only if no membership remains. A talent in
 *   two agencies removed by one keeps the other agency's videos + account.
 *   Authorization (canEraseUser) is evaluated against that agency alone.
 * - After the erasure the erased person gets a confirmation email and, on a
 *   scoped removal, the agency owners get a receipt (D15). Email failure is
 *   logged + Sentry'd and never fails the erasure.
 *
 * Authorization (no user enumeration — a generic 403 is returned before any
 * existence check). The decision lives in lib/erasure.ts canEraseUser() so
 * the full matrix has real executed unit-test coverage:
 * - Self-erasure is always allowed.
 * - An owner may erase any target belonging to an agency they own.
 *   Accepted risk (documented): erasure is account-wide, so this also
 *   removes elevated roles the target holds in other agencies.
 * - An admin_agent may only erase a target who holds NO elevated role
 *   (owner/admin_agent) in ANY agency — checked across the target's entire
 *   membership set, not per shared agency, to close the cross-agency
 *   escalation where an admin_agent could account-wide-erase a target who
 *   is owner/admin_agent of an unrelated agency.
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
 *
 * Partial-failure recovery: if auth.admin.deleteUser fails AFTER the
 * memberships were deleted (eraseUser step 5, deliberately last — see D1
 * above for why the ordering must not change), an admin retry of this
 * endpoint will 403 (the target now has zero memberships, so canEraseUser
 * denies every non-self caller) and only the target themself could re-call
 * it. In that state auth.users may still hold the real email with no API
 * recovery path — complete the erasure manually with the service role:
 * `supabase.auth.admin.deleteUser(<userId>)` via the Supabase dashboard or
 * a one-off script.
 *
 * Audit limitation: audit_log.agency_id is NOT NULL, so a target who
 * belongs to zero agencies at erasure time produces no audit_log row; the
 * erasure is instead recorded via a structured server-side log line below.
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

  const isSelf = user.id === targetUserId

  // Non-self callers must name the agency the removal is scoped to (D13).
  const agencyIdParam = request.nextUrl.searchParams.get('agencyId')
  if (!isSelf && (!agencyIdParam || !isValidUUID(agencyIdParam))) {
    return NextResponse.json({ error: 'agencyId is required' }, { status: 400 })
  }
  const scopedAgencyId = isSelf ? null : agencyIdParam

  // ---- Admin client (service-role, bypasses RLS) ---------------------------
  const admin = createAdminClient()

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
  // same generic 403 below (targetMemberships is [] either way). The
  // decision matrix itself lives in canEraseUser (lib/erasure.ts) where it
  // has real executed unit-test coverage.
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

    // Scoped to the one agency named in the request (D13): memberships in any
    // other agency are irrelevant to this removal, so they're filtered out.
    const inScope = (m: { agency_id: string }) => m.agency_id === scopedAgencyId
    if (
      !canEraseUser(
        user.id,
        targetUserId,
        (callerMemberships ?? []).filter(inScope),
        (targetMemberships ?? []).filter(inScope)
      )
    ) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  // ---- Sole-owner guard (409) — applies to self-erasure too. An agency must
  // never be left without an owner.
  // Known narrow TOCTOU: two co-owners erased concurrently could both pass
  // the count>1 check — accepted because the endpoint is rate-limited (5/hr,
  // fail-closed) and PostgREST offers no cross-statement transaction here.
  const ownerAgencyIds = (targetMemberships ?? [])
    .filter((m) => m.role === 'owner' && (isSelf || m.agency_id === scopedAgencyId))
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
    .select('id, email, full_name')
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

  // ---- Actor identity for the audit trail / purge audit rows. Self-erasure
  // uses a null actor + the same "Deleted User" name the tombstone writes —
  // logging the caller's real identity would re-introduce scrubbed PII.
  const actorId = isSelf ? null : user.id
  const actorName = isSelf
    ? DELETED_USER_NAME
    : typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)

  // ---- Erase -----------------------------------------------------------
  // Capture the target's identity BEFORE the tombstone overwrites it (emails).
  const targetIdentity = {
    id: targetUserId,
    email: (targetUser.email as string | null) ?? null,
    fullName: (targetUser.full_name as string | null) ?? null,
  }

  const result =
    isSelf || !scopedAgencyId
      ? await eraseUser(admin, targetUserId)
      : await removeMemberWithData(admin, targetUserId, scopedAgencyId, {
          id: user.id,
          name: actorName,
        })

  if (!result.ok) {
    console.error(
      `[users/[userId]/data:DELETE] Erasure failed at step "${result.step}":`,
      result.message
    )
    return NextResponse.json({ error: 'Erasure failed', step: result.step }, { status: 500 })
  }

  // ---- Emails (D15). Awaited — a fire-and-forget send is dropped when
  // Vercel freezes the function at response time — but sendErasureEmails
  // never throws, and the catch below is belt-and-braces: the erasure has
  // already happened and must never be reported as failed because of email.
  try {
    await sendErasureEmails(admin, {
      target: targetIdentity,
      agencyId: scopedAgencyId,
      accountErased: 'accountErased' in result ? result.accountErased !== false : true,
    })
  } catch (err) {
    console.error('[users/[userId]/data:DELETE] erasure email step threw:', err)
  }

  // ---- Audit: fire-and-forget, one event per agency the target belonged
  // to (just the scoped agency on an agency-scoped removal).

  for (const agencyId of result.agencyIds) {
    logEvent({
      action: 'user_erased',
      resourceType: 'user',
      resourceId: targetUserId,
      agencyId,
      actorId,
      actorName,
      adminClient: admin,
    }).catch((err) => console.error('[users/[userId]/data] logEvent unhandled rejection:', err))
  }

  if (result.agencyIds.length === 0) {
    // audit_log.agency_id is NOT NULL, so a zero-agency target can't get an
    // audit_log row — record the erasure in server logs instead (see the
    // "Audit limitation" note in the route header).
    console.error(
      '[users/[userId]/data:DELETE] user_erased (no agency memberships — not written to audit_log):',
      { targetUserId, actorId }
    )
  }

  return NextResponse.json({ success: true }, { status: 200 })
}
