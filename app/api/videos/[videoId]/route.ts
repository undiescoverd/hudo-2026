import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireMembership } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

/**
 * PATCH /api/videos/:videoId
 *
 * Updates title and/or description for a video.
 * Talent can only edit their own videos; agents can edit any video in the agency.
 */
const PATCH_RATE_LIMIT = 30 // max requests per window
const PATCH_RATE_WINDOW = 60 // 1 minute in seconds

export async function PATCH(request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[video:patch] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 30 patch requests per user per minute
  const rl = await checkRateLimit(
    `video:patch:user:${user.id}`,
    PATCH_RATE_LIMIT,
    PATCH_RATE_WINDOW,
    'video:patch',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch video and verify agency membership
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id, talent_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const membership = await requireMembership(admin, user.id, video.agency_id)
  if (membership instanceof NextResponse) return membership

  // Talent can only edit their own videos
  if (membership.role === 'talent' && video.talent_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Parse and validate body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { title, description } = body as { title?: unknown; description?: unknown }

  const updates: { title?: string; description?: string; updated_at: string } = {
    updated_at: new Date().toISOString(),
  }

  if (title !== undefined) {
    if (typeof title !== 'string') {
      return NextResponse.json({ error: 'Title must be a string' }, { status: 400 })
    }
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
    }
    if (trimmedTitle.length > 200) {
      return NextResponse.json({ error: 'Title must be 200 characters or fewer' }, { status: 400 })
    }
    updates.title = trimmedTitle
  }

  if (description !== undefined) {
    if (typeof description !== 'string') {
      return NextResponse.json({ error: 'Description must be a string' }, { status: 400 })
    }
    const trimmedDescription = description.trim()
    if (trimmedDescription.length > 2000) {
      return NextResponse.json(
        { error: 'Description must be 2000 characters or fewer' },
        { status: 400 }
      )
    }
    updates.description = trimmedDescription
  }

  const { data: updated, error: updateError } = await admin
    .from('videos')
    .update(updates)
    .eq('id', videoId)
    .select('id, title, description')
    .single()

  if (updateError || !updated) {
    console.error('[video:patch] Failed to update video:', updateError?.message)
    return NextResponse.json({ error: 'Failed to update video' }, { status: 500 })
  }

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    description: updated.description,
  })
}
