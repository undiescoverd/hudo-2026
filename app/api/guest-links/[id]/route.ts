import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireAgentRole } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'
import { logEvent } from '@/lib/audit'

/**
 * DELETE /api/guest-links/:id
 *
 * Revokes a guest link by setting revoked_at = now().
 * Never hard-deletes the row.
 *
 * The requesting user must be an agent/admin_agent/owner in the agency
 * that owns the video the link belongs to.
 */
const REVOKE_RATE_LIMIT = 30
const REVOKE_RATE_WINDOW = 60

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params

  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid guest link ID' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[guest-links:delete] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const rl = await checkRateLimit(
    `guest-links:delete:user:${user.id}`,
    REVOKE_RATE_LIMIT,
    REVOKE_RATE_WINDOW,
    'guest-links:delete',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: link } = await admin
    .from('guest_links')
    .select('id, video_id, agency_id, revoked_at')
    .eq('id', id)
    .single()

  if (!link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const membership = await requireAgentRole(
    admin,
    user.id,
    link.agency_id,
    'Only agents can revoke guest links'
  )
  if (membership instanceof NextResponse) return membership

  // Already revoked — return 404 (no enumeration of revocation state)
  if (link.revoked_at !== null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { error: updateError } = await admin
    .from('guest_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)

  if (updateError) {
    console.error('[guest-links:delete] Failed to revoke guest link:', updateError.message)
    return NextResponse.json({ error: 'Failed to revoke guest link' }, { status: 500 })
  }

  // Audit: fire-and-forget
  const actorName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)
  logEvent({
    action: 'guest_link_revoked',
    resourceType: 'guest_link',
    resourceId: id,
    agencyId: link.agency_id,
    actorId: user.id,
    actorName,
    metadata: { video_id: link.video_id },
  }).catch((err) => console.error('[guest-links:delete] logEvent unhandled rejection:', err))

  return new NextResponse(null, { status: 204 })
}
