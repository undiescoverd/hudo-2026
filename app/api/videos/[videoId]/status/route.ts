import { createAdminClient } from '@/lib/supabase-admin'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/api-helpers'
import { AGENT_ROLES } from '@/lib/auth-helpers'
import { isVideoStatus, canTransition } from '@/lib/video-status'
import { isValidUUID } from '@/lib/validation'
import type { UserRole } from '@/lib/auth'

/**
 * PATCH /api/videos/:videoId/status
 *
 * Updates the status of a video, enforcing the transition matrix and writing
 * an audit_log entry (insert-only via service-role client).
 *
 * Security:
 *  - Authenticated users only (401)
 *  - User must have agency membership for the video (404 if not visible, 403 for role violations)
 *  - Transition matrix enforced via canTransition()
 *  - Rate-limited: 20 req / IP / min
 *  - audit_log insert is REQUIRED — endpoint never succeeds without it
 */

const STATUS_RATE_LIMIT = 20 // max requests per window
const STATUS_RATE_WINDOW = 60 // 1 minute in seconds

export async function PATCH(request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[video:status:patch] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // Rate limit by IP: 20 requests / minute
  const ip =
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const rl = await checkRateLimit(
    `video:status:ip:${ip}`,
    STATUS_RATE_LIMIT,
    STATUS_RATE_WINDOW,
    'video:status:patch',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  // Auth via session (RLS applies to video lookup)
  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit by user ID: 20 requests / minute (prevents per-user self-DOS / bulk abuse)
  const userRl = await checkRateLimit(
    `video:status:user:${user.id}`,
    STATUS_RATE_LIMIT,
    STATUS_RATE_WINDOW,
    'video:status:patch',
    'Too many requests. Please try again later.'
  )
  if (userRl) return userRl

  // Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status: newStatus } = body as { status?: unknown }

  if (typeof newStatus !== 'string' || !isVideoStatus(newStatus)) {
    return NextResponse.json(
      {
        error:
          'Invalid status. Must be one of: draft, pending_review, in_review, changes_requested, approved',
      },
      { status: 400 }
    )
  }

  // Look up the video using the auth-session client — RLS confirms visibility
  const { data: video, error: videoError } = await supabase
    .from('videos')
    .select('id, agency_id, talent_id, status')
    .eq('id', videoId)
    .maybeSingle()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  // Resolve the effective role for this (user, video) pair.
  // We need the memberships for this specific agency from auth-helpers result.
  const { data: memberships } = await supabase
    .from('memberships')
    .select('role, agency_id')
    .eq('user_id', user.id)

  const rows = (memberships ?? []) as Array<{ role: string; agency_id: string }>

  // agent_agency_ids: agencies where caller holds owner|admin_agent|agent
  const agentAgencyIds = rows
    .filter((m) => AGENT_ROLES.has(m.role as UserRole))
    .map((m) => m.agency_id)

  let effectiveRole: UserRole

  if (agentAgencyIds.includes(video.agency_id)) {
    // User holds an agent+ role in the video's agency
    // Resolve their specific role for this agency (highest-privilege)
    const agencyRows = rows.filter((m) => m.agency_id === video.agency_id)
    const roleOrder: UserRole[] = ['owner', 'admin_agent', 'agent', 'talent']
    agencyRows.sort(
      (a, b) => roleOrder.indexOf(a.role as UserRole) - roleOrder.indexOf(b.role as UserRole)
    )
    effectiveRole = (agencyRows[0]?.role as UserRole) ?? 'talent'
  } else if (video.talent_id === user.id) {
    // Not an agent for this agency, but is the talent who owns the video
    effectiveRole = 'talent'
  } else {
    // User cannot see this video (or it's outside their scope)
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Enforce transition matrix
  const currentStatus = video.status as string
  if (!isVideoStatus(currentStatus)) {
    console.error(
      `[video:status:patch] Video ${videoId} has invalid stored status: ${currentStatus}`
    )
    return NextResponse.json({ error: 'Server error: invalid stored status' }, { status: 500 })
  }

  if (!canTransition(currentStatus, newStatus, effectiveRole)) {
    return NextResponse.json(
      {
        error: `Transition from '${currentStatus}' to '${newStatus}' is not allowed for role '${effectiveRole}'`,
      },
      { status: 403 }
    )
  }

  // Use service-role client for both audit_log insert and video update.
  // audit_log is insert-only — RLS blocks client writes.
  const admin = createAdminClient()

  const actorName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)

  // Insert audit_log FIRST — if this fails we must abort (no silent status changes without audit).
  const { error: auditError } = await admin.from('audit_log').insert({
    agency_id: video.agency_id,
    actor_id: user.id,
    actor_name: actorName,
    action: 'status_changed',
    resource_type: 'video',
    resource_id: video.id,
    metadata: { old_status: currentStatus, new_status: newStatus },
  })

  if (auditError) {
    console.error('[video:status:patch] audit_log insert failed:', auditError.message)
    return NextResponse.json(
      { error: 'Failed to record audit log; status not changed' },
      { status: 500 }
    )
  }

  // Now update the video status
  const { error: updateError } = await admin
    .from('videos')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', videoId)

  if (updateError) {
    // Audit row already written — log loudly so operators can reconcile.
    console.error('[video:status:patch] CRITICAL: audit_log written but video update failed', {
      videoId,
      auditOrphan: true,
      updateError: updateError.message,
    })
    return NextResponse.json({ error: 'Failed to update video status' }, { status: 500 })
  }

  return NextResponse.json({ id: videoId, status: newStatus })
}
