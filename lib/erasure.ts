import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { sendEmail } from '@/lib/email'
import { renderErasureConfirmationEmail } from '@/lib/email-templates/erasure-confirmation'
import { renderMemberRemovedReceiptEmail } from '@/lib/email-templates/member-removed-receipt'

/** Denormalised display name written to users.full_name and audit_log.actor_name on erasure. */
export const DELETED_USER_NAME = 'Deleted User'

/**
 * Tombstone email — satisfies users.email's NOT NULL UNIQUE constraint while
 * remaining unambiguously non-deliverable. `erased.invalid` is the RFC 2606
 * reserved "invalid" TLD, guaranteed to never resolve.
 */
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@erased.invalid`
}

export type ErasureResult =
  | { ok: true; agencyIds: string[] }
  | { ok: false; step: string; message: string }

/** A (agency_id, role) membership pair as read from the memberships table. */
export type MembershipRecord = { agency_id: string; role: string }

const ELEVATED_ROLES = new Set(['owner', 'admin_agent'])

/**
 * canEraseUser — pure authorization decision for the right-to-erasure
 * endpoint (S3-COMPLY-002). Extracted from the route so the full matrix is
 * unit-testable with real executed tests, not just source-pattern checks.
 *
 * Rules:
 * - Self-erasure is always allowed.
 * - Removal is scoped to ONE agency (S4-ERASE-001, D13): the route passes
 *   only the caller's and target's memberships in that agency, so every rule
 *   below is evaluated against that agency alone. Memberships elsewhere are
 *   untouched (the account is erased only when none remain).
 * - An `owner` of that agency may remove any member of it.
 * - An `admin_agent` may remove a member only if the target holds no elevated
 *   role (owner/admin_agent) within the memberships supplied, i.e. in that
 *   agency. (Direct callers passing a full membership set get the stricter
 *   account-wide check.)
 * - No shared agency (including an empty target membership set) → denied.
 */
export function canEraseUser(
  callerId: string,
  targetUserId: string,
  callerMemberships: MembershipRecord[],
  targetMemberships: MembershipRecord[]
): boolean {
  if (callerId === targetUserId) return true

  const targetIsElevated = targetMemberships.some((m) => ELEVATED_ROLES.has(m.role))
  const callerRoleByAgency = new Map(callerMemberships.map((m) => [m.agency_id, m.role]))

  return targetMemberships.some((tm) => {
    const callerRole = callerRoleByAgency.get(tm.agency_id)
    if (callerRole === 'owner') return true
    if (callerRole === 'admin_agent' && !targetIsElevated) return true
    return false
  })
}

/**
 * eraseUser — GDPR right-to-erasure for a single user (S3-COMPLY-002).
 *
 * `public.users` cannot be row-deleted: six FKs reference it with the default
 * RESTRICT behaviour (invitations.invited_by, videos.talent_id,
 * video_versions.uploaded_by, comments.user_id, comments.resolved_by,
 * guest_links.created_by), so deleting the row would fail wherever the user
 * has any history. Instead the row is tombstoned in place (id preserved for
 * referential integrity) and every other per-user table is scrubbed.
 *
 * Every step is idempotent (UPDATE/DELETE by id, or a 404-tolerant auth
 * delete), so re-running this after a partial failure recovers cleanly.
 * Never throws — callers get a discriminated-union result instead.
 */
export async function eraseUser(
  admin: SupabaseClient,
  targetUserId: string
): Promise<ErasureResult> {
  const result = await eraseUserInner(admin, targetUserId)
  // Anything past the capture step may follow destructive purges: make a
  // partial erasure visible (fixed message, no PII — the step is a constant).
  if (!result.ok && result.step !== 'capture_memberships') alertPartialErasure(result.step)
  return result
}

/** Fixed-message Sentry alert for a failure after a destructive step. No PII. */
function alertPartialErasure(step: string): void {
  Sentry.captureMessage('erasure: failure after destructive step', {
    level: 'error',
    tags: { step },
  })
}

async function eraseUserInner(admin: SupabaseClient, targetUserId: string): Promise<ErasureResult> {
  try {
    // 1. Capture the target's memberships (agency_id, role) before they're
    //    deleted — the caller uses agencyIds to fire one audit event per
    //    agency the target belonged to.
    const { data: memberships, error: membershipsSelectError } = await admin
      .from('memberships')
      .select('agency_id, role')
      .eq('user_id', targetUserId)

    if (membershipsSelectError) {
      return {
        ok: false,
        step: 'capture_memberships',
        message: membershipsSelectError.message,
      }
    }

    const agencyIds = (memberships ?? []).map((m) => m.agency_id as string)

    // 1a. Agencies where the talent still owns videos but no longer has a
    //     membership (e.g. removed earlier) must be purged too (L2).
    const { data: videoRows, error: videosSelectError } = await admin
      .from('videos')
      .select('agency_id')
      .eq('talent_id', targetUserId)

    if (videosSelectError) {
      return { ok: false, step: 'capture_videos', message: videosSelectError.message }
    }

    const purgeAgencyIds = Array.from(
      new Set([...agencyIds, ...(videoRows ?? []).map((v) => v.agency_id as string)])
    )

    // 1b. Permanently delete the target's videos in every agency they belong
    //     to (D12, D13 self-erasure) via the single purge path. Runs BEFORE the
    //     tombstone and is idempotent (purge_video returns 0 for a missing
    //     video), so a retry after a partial failure recovers cleanly.
    for (const agencyId of purgeAgencyIds) {
      const { error: purgeError } = await admin.rpc('purge_talent_in_agency', {
        p_talent_id: targetUserId,
        p_agency_id: agencyId,
        p_actor_id: null,
        p_actor_name: 'GDPR erasure',
      })
      if (purgeError) {
        return { ok: false, step: 'purge_talent_videos', message: purgeError.message }
      }
    }

    // 2. Tombstone the users row (UPDATE, never DELETE — see file header).
    const { error: tombstoneError } = await admin
      .from('users')
      .update({
        email: tombstoneEmail(targetUserId),
        full_name: DELETED_USER_NAME,
        avatar_url: null,
      })
      .eq('id', targetUserId)

    if (tombstoneError) {
      return { ok: false, step: 'tombstone_user', message: tombstoneError.message }
    }

    // 3. Anonymise audit_log entries authored by the target. audit_log is
    //    insert-only for clients (RLS), but the service-role client used
    //    here bypasses RLS — this UPDATE is the one sanctioned exception to
    //    the "insert-only" rule, scoped to actor PII scrubbing only.
    const { error: auditError } = await admin
      .from('audit_log')
      .update({ actor_name: DELETED_USER_NAME, actor_id: null })
      .eq('actor_id', targetUserId)

    if (auditError) {
      return { ok: false, step: 'anonymize_audit_log', message: auditError.message }
    }

    // 4. Delete per-user rows in tables that key on this user's id.
    const { error: membershipsDeleteError } = await admin
      .from('memberships')
      .delete()
      .eq('user_id', targetUserId)

    if (membershipsDeleteError) {
      return { ok: false, step: 'delete_memberships', message: membershipsDeleteError.message }
    }

    const { error: notificationsDeleteError } = await admin
      .from('notifications')
      .delete()
      .eq('recipient_id', targetUserId)

    if (notificationsDeleteError) {
      return {
        ok: false,
        step: 'delete_notifications',
        message: notificationsDeleteError.message,
      }
    }

    const { error: notificationPreferencesDeleteError } = await admin
      .from('notification_preferences')
      .delete()
      .eq('user_id', targetUserId)

    if (notificationPreferencesDeleteError) {
      return {
        ok: false,
        step: 'delete_notification_preferences',
        message: notificationPreferencesDeleteError.message,
      }
    }

    const { error: commentReadsDeleteError } = await admin
      .from('comment_reads')
      .delete()
      .eq('user_id', targetUserId)

    if (commentReadsDeleteError) {
      return { ok: false, step: 'delete_comment_reads', message: commentReadsDeleteError.message }
    }

    // 5. Revoke all Supabase auth sessions + permanently block sign-in.
    //    Treat "already gone" as success for idempotency (re-running after a
    //    partial failure must not error just because this step already ran).
    const { error: deleteAuthUserError } = await admin.auth.admin.deleteUser(targetUserId)

    if (deleteAuthUserError) {
      const isNotFound =
        deleteAuthUserError.status === 404 || deleteAuthUserError.code === 'user_not_found'
      if (!isNotFound) {
        return {
          ok: false,
          step: 'delete_auth_user',
          message: deleteAuthUserError.message,
        }
      }
    }

    return { ok: true, agencyIds }
  } catch (err) {
    return {
      ok: false,
      step: 'unexpected',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

export type RemoveMemberResult = ErasureResult & { accountErased?: boolean }

/**
 * removeMemberWithData — agency-scoped removal (D13). Deletes the person's
 * videos in THAT agency only (via purge_talent_in_agency), removes that
 * membership, and erases the account only if no membership remains. A talent
 * in two agencies removed by one keeps their videos, membership and account in
 * the other. Idempotent; never throws.
 */
export async function removeMemberWithData(
  admin: SupabaseClient,
  targetUserId: string,
  agencyId: string,
  actor: { id: string; name: string }
): Promise<RemoveMemberResult> {
  try {
    const { error: purgeError } = await admin.rpc('purge_talent_in_agency', {
      p_talent_id: targetUserId,
      p_agency_id: agencyId,
      p_actor_id: actor.id,
      p_actor_name: actor.name,
    })
    if (purgeError) {
      return { ok: false, step: 'purge_talent_videos', message: purgeError.message }
    }

    // Decide BEFORE deleting anything: if this is the target's last membership,
    // eraseUser deletes memberships itself (after the tombstone), so a failure
    // leaves the membership in place and an admin retry still passes authz (M1).
    const { data: held, error: heldError } = await admin
      .from('memberships')
      .select('agency_id')
      .eq('user_id', targetUserId)
    if (heldError) {
      return { ok: false, step: 'count_remaining_memberships', message: heldError.message }
    }
    const others = (held ?? []).filter((m) => m.agency_id !== agencyId)

    if (others.length > 0) {
      const { error: deleteError } = await admin
        .from('memberships')
        .delete()
        .eq('user_id', targetUserId)
        .eq('agency_id', agencyId)
      if (deleteError) {
        alertPartialErasure('delete_membership')
        return { ok: false, step: 'delete_membership', message: deleteError.message }
      }
      return { ok: true, agencyIds: [agencyId], accountErased: false }
    }

    const erased = await eraseUser(admin, targetUserId)
    if (!erased.ok) return erased
    return { ok: true, agencyIds: [agencyId], accountErased: true }
  } catch (err) {
    return {
      ok: false,
      step: 'unexpected',
      message: err instanceof Error ? err.message : String(err),
    }
  }
}

type SendFn = (params: {
  to: string | string[]
  subject: string
  html: string
  text?: string
}) => Promise<unknown>

/**
 * sendErasureEmails — D15. Confirmation to the erased person; on a scoped
 * removal (agencyId set) also a receipt to the agency's other owners.
 * The target's email/name MUST be captured before the tombstone and passed in.
 * An email failure is logged + sent to Sentry and NEVER propagates — the
 * erasure has already happened and must not be reported as failed.
 */
export async function sendErasureEmails(
  admin: SupabaseClient,
  params: {
    target: { id: string; email: string | null; fullName: string | null }
    agencyId: string | null
    accountErased: boolean
  },
  send: SendFn = sendEmail
): Promise<void> {
  const { target, agencyId, accountErased } = params
  const fail = (step: string, err: unknown) => {
    // No raw error text: it may echo an email address (PII). Name only.
    console.error(`[erasure:email] ${step} failed:`, err instanceof Error ? err.name : 'error')
    Sentry.captureMessage('erasure email failed', { level: 'warning', tags: { step } })
  }

  let agencyName: string | null = null
  if (agencyId) {
    try {
      const { data, error } = await admin
        .from('agencies')
        .select('name')
        .eq('id', agencyId)
        .single()
      if (error) fail('agency lookup', error)
      agencyName = (data as { name?: string } | null)?.name ?? null
    } catch (err) {
      fail('agency lookup', err)
    }
  }

  // Neutral wording when the name could not be resolved — never render a blank.
  if (agencyId && !agencyName) agencyName = 'an agency'

  if (target.email && !target.email.endsWith('@erased.invalid')) {
    try {
      const mail = renderErasureConfirmationEmail({
        recipientName: target.fullName?.trim() || 'there',
        agencyName,
        accountErased,
      })
      await send({ to: target.email, ...mail })
    } catch (err) {
      fail('confirmation', err)
    }
  }

  if (agencyId) {
    try {
      const { data: owners, error: ownersError } = await admin
        .from('memberships')
        .select('user_id')
        .eq('agency_id', agencyId)
        .eq('role', 'owner')
      if (ownersError) throw new Error(ownersError.message)
      const ownerIds = (owners ?? [])
        .map((o) => o.user_id as string)
        .filter((id) => id !== target.id)
      if (ownerIds.length === 0) return

      const { data: users, error: usersError } = await admin
        .from('users')
        .select('id, email, full_name')
        .in('id', ownerIds)
      if (usersError) throw new Error(usersError.message)

      for (const owner of (users ?? []) as { email: string | null; full_name: string | null }[]) {
        if (!owner.email || owner.email.endsWith('@erased.invalid')) continue
        try {
          const mail = renderMemberRemovedReceiptEmail({
            ownerName: owner.full_name?.trim() || 'there',
            agencyName: agencyName === 'an agency' ? 'your agency' : (agencyName ?? 'your agency'),
            removedName: target.fullName?.trim() || 'A member',
            accountErased,
          })
          await send({ to: [owner.email], ...mail })
        } catch (err) {
          fail('owner receipt', err)
        }
      }
    } catch (err) {
      fail('owner receipt lookup', err)
    }
  }
}
