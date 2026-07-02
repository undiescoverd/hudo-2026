/**
 * GET  /api/notifications  — list recent notifications for current user (newest first, cap 50)
 * PATCH /api/notifications  — mark all unread notifications as read for current user
 *
 * Security:
 * - Authenticated users only (401)
 * - All queries scoped to recipient_id = user.id — no agency gate needed
 * - Rate-limited via Upstash Redis
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'

const NOTIFICATIONS_RATE_LIMIT = 60
const NOTIFICATIONS_RATE_WINDOW = 60 // seconds

function getEnvVars() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  return { supabaseUrl, supabaseAnonKey }
}

async function getAuthenticatedUser(supabaseUrl: string, supabaseAnonKey: string) {
  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * GET /api/notifications
 * Returns up to 50 recent notifications for the current user (newest first),
 * plus total unread_count (may be > 50).
 */
export async function GET() {
  const { supabaseUrl, supabaseAnonKey } = getEnvVars()

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[notifications:GET] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const user = await getAuthenticatedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `notifications:get:user:${user.id}`,
      NOTIFICATIONS_RATE_LIMIT,
      NOTIFICATIONS_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(NOTIFICATIONS_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    console.error('[notifications:GET] Rate limit check failed, allowing request:', err)
  }

  const admin = createAdminClient()

  // Fetch up to 50 most recent notifications for this user
  const { data: notifications, error: fetchErr } = await admin
    .from('notifications')
    .select(
      'id, recipient_id, video_id, comment_id, agency_id, payload, read_at, sent_at, created_at, type'
    )
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (fetchErr) {
    console.error('[notifications:GET] Fetch failed:', fetchErr)
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }

  // Separate count query so unread_count is accurate even if > 50
  const { count: unreadCount, error: countErr } = await admin
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  if (countErr) {
    console.error('[notifications:GET] Count failed:', countErr)
    return NextResponse.json({ error: 'Failed to fetch notification count' }, { status: 500 })
  }

  return NextResponse.json({
    notifications: notifications ?? [],
    unread_count: unreadCount ?? 0,
  })
}

/**
 * PATCH /api/notifications
 * Marks all unread notifications as read for the current user.
 */
export async function PATCH() {
  const { supabaseUrl, supabaseAnonKey } = getEnvVars()

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[notifications:PATCH] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const user = await getAuthenticatedUser(supabaseUrl, supabaseAnonKey)
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `notifications:patch-all:user:${user.id}`,
      NOTIFICATIONS_RATE_LIMIT,
      NOTIFICATIONS_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(NOTIFICATIONS_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    console.error('[notifications:PATCH] Rate limit check failed, allowing request:', err)
  }

  const admin = createAdminClient()

  const { error: updateErr } = await admin
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  if (updateErr) {
    console.error('[notifications:PATCH] Mark-all-read failed:', updateErr)
    return NextResponse.json({ error: 'Failed to mark notifications as read' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
