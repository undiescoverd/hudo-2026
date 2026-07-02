/**
 * PATCH /api/notifications/:id — mark a single notification as read
 *
 * Security:
 * - Authenticated users only (401)
 * - Scoped to recipient_id = user.id — the update is the authorization check
 * - 404 if notification not found or belongs to another user (no information leakage)
 * - Rate-limited via Upstash Redis
 */

import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { isValidUUID } from '@/lib/validation'

const NOTIFICATIONS_PATCH_RATE_LIMIT = 60
const NOTIFICATIONS_PATCH_RATE_WINDOW = 60 // seconds

/**
 * PATCH /api/notifications/:id
 * Marks a single notification as read for the current user.
 * Returns 404 if the notification does not exist or belongs to another user.
 */
export async function PATCH(_request: NextRequest, { params }: { params: { id: string } }) {
  const { id: notificationId } = params

  if (!isValidUUID(notificationId)) {
    return NextResponse.json({ error: 'Invalid notification ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[notifications/[id]:PATCH] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `notifications:patch:user:${user.id}`,
      NOTIFICATIONS_PATCH_RATE_LIMIT,
      NOTIFICATIONS_PATCH_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(NOTIFICATIONS_PATCH_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    console.error('[notifications/[id]:PATCH] Rate limit check failed, allowing request:', err)
  }

  const admin = createAdminClient()

  // Scope update to both id AND recipient_id — this is the authorization check.
  // If the notification belongs to another user, zero rows are updated → 404.
  const { data: updated, error: updateErr } = await admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('recipient_id', user.id)
    .select('id, read_at')

  if (updateErr) {
    console.error('[notifications/[id]:PATCH] Update failed:', updateErr)
    return NextResponse.json({ error: 'Failed to mark notification as read' }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
  }

  return NextResponse.json({ notification: updated[0] })
}
