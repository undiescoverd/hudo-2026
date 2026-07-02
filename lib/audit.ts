import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

/**
 * Valid action values as defined in 0001_initial_schema.sql.
 */
export type AuditAction =
  | 'status_changed'
  | 'version_uploaded'
  | 'invitation_sent'
  | 'invitation_accepted'
  | 'role_changed'
  | 'guest_link_created'
  | 'guest_link_revoked'
  | 'billing_plan_changed'
  | 'billing_payment_failed'

/**
 * Valid resource_type values as defined in 0001_initial_schema.sql.
 */
export type AuditResourceType = 'video' | 'comment' | 'membership' | 'guest_link' | 'billing'

export type LogEventParams = {
  action: AuditAction
  resourceType: AuditResourceType
  /** NOT NULL — must be a concrete UUID. */
  resourceId: string
  agencyId: string
  /** Nullable: may be null after user erasure. */
  actorId: string | null
  /** Denormalised display name; fallback to email or id. */
  actorName: string
  metadata?: Record<string, unknown>
  /** Injectable admin client for testing. Defaults to service-role client. */
  adminClient?: SupabaseClient
}

function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('[audit] Missing Supabase env vars')
  return createClient(url, key)
}

/**
 * Inserts an audit_log entry via the service-role client (RLS blocks authenticated-client writes).
 *
 * IMPORTANT: This function must never throw into the request path. On failure it
 * logs to console.error and returns — auditing failure must not break the user action.
 *
 * NOTE: The audit_log table has no client INSERT/UPDATE/DELETE RLS policy (see
 * 0002_rls_policies.sql) — inserts succeed only via the service role. No update
 * or delete policy is added here or anywhere; the table is insert-only by design.
 *
 * NOTE: app/api/videos/[videoId]/status/route.ts intentionally does NOT use this
 * helper — that route's audit insert is a hard gate (status change is aborted on
 * audit failure). The fire-and-forget semantics here would be a regression there.
 */
export async function logEvent({
  action,
  resourceType,
  resourceId,
  agencyId,
  actorId,
  actorName,
  metadata,
  adminClient,
}: LogEventParams): Promise<void> {
  let admin: SupabaseClient
  try {
    admin = adminClient ?? createAdminClient()
  } catch (err) {
    console.error('[audit:logEvent] Config error:', err)
    return
  }

  const { error } = await admin.from('audit_log').insert({
    agency_id: agencyId,
    actor_id: actorId,
    actor_name: actorName,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
    metadata: metadata ?? null,
  })

  if (error) {
    console.error('[audit:logEvent] Insert failed:', {
      action,
      resourceType,
      resourceId,
      error: error.message,
    })
    // Compliance-relevant: a lost audit_log write should be visible even
    // though we deliberately do not fail the request (see IMPORTANT above).
    Sentry.captureException(error)
  }
}
