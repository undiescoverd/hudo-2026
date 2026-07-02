import type { SupabaseClient } from '@supabase/supabase-js'

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
 * - An `owner` may erase any target who belongs to an agency they own.
 *   Accepted risk (documented): erasure is account-wide, so an owner in one
 *   shared agency erases the target's memberships in ALL agencies, including
 *   elevated roles held elsewhere.
 * - An `admin_agent` may only erase a target who holds NO elevated role
 *   (owner/admin_agent) in ANY agency — checked across the target's entire
 *   membership set, not per shared agency. A per-pair check would allow a
 *   cross-agency escalation: an admin_agent sharing agency B with a target
 *   who is `agent` there could account-wide-erase that target's `owner`
 *   membership in unrelated agency A.
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
