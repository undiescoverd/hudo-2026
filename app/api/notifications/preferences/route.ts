/**
 * PATCH /api/notifications/preferences
 *
 * Updates (or creates) the current user's notification preferences.
 * Scoped to the authenticated user — no agency role required.
 *
 * Body: { email_enabled?: boolean; batch_window_minutes?: 5 | 15 | 30 | 60 }
 */
import { createAdminClient } from '@/lib/supabase-admin'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit } from '@/lib/api-helpers'

const ALLOWED_BATCH_WINDOWS = [5, 15, 30, 60] as const
type BatchWindow = (typeof ALLOWED_BATCH_WINDOWS)[number]

const RATE_LIMIT = 20 // requests per window
const RATE_WINDOW = 60 // seconds

export async function PATCH(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[notifications:preferences] Missing Supabase environment variables')
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
    `notifications:preferences:${user.id}`,
    RATE_LIMIT,
    RATE_WINDOW,
    'notifications:preferences',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email_enabled, batch_window_minutes } = body as {
    email_enabled?: unknown
    batch_window_minutes?: unknown
  }

  // Validate fields present in the body
  if (email_enabled !== undefined && typeof email_enabled !== 'boolean') {
    return NextResponse.json({ error: 'email_enabled must be a boolean' }, { status: 400 })
  }

  if (batch_window_minutes !== undefined) {
    if (!(ALLOWED_BATCH_WINDOWS as readonly unknown[]).includes(batch_window_minutes)) {
      return NextResponse.json(
        { error: `batch_window_minutes must be one of: ${ALLOWED_BATCH_WINDOWS.join(', ')}` },
        { status: 400 }
      )
    }
  }

  const admin = createAdminClient()

  // Fetch current row to merge defaults correctly
  const { data: existing } = await admin
    .from('notification_preferences')
    .select('email_enabled, batch_window_minutes')
    .eq('user_id', user.id)
    .maybeSingle()

  const merged = {
    user_id: user.id,
    email_enabled:
      email_enabled !== undefined ? (email_enabled as boolean) : (existing?.email_enabled ?? true),
    batch_window_minutes:
      batch_window_minutes !== undefined
        ? (batch_window_minutes as BatchWindow)
        : (existing?.batch_window_minutes ?? 15),
    updated_at: new Date().toISOString(),
  }

  const { data: updated, error: upsertError } = await admin
    .from('notification_preferences')
    .upsert(merged, { onConflict: 'user_id' })
    .select('email_enabled, batch_window_minutes, updated_at')
    .single()

  if (upsertError || !updated) {
    console.error('[notifications:preferences] Upsert failed:', upsertError?.message)
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 })
  }

  return NextResponse.json({
    email_enabled: updated.email_enabled,
    batch_window_minutes: updated.batch_window_minutes,
    updated_at: updated.updated_at,
  })
}
