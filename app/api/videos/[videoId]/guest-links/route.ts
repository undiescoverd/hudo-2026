import type { SupabaseClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireAgentRole } from '@/lib/api-helpers'
import { generateGuestToken, hashGuestToken } from '@/lib/guest-tokens'
import { isValidUUID } from '@/lib/validation'
import { logEvent } from '@/lib/audit'
import { createAdminClient } from '@/lib/supabase-admin'

/**
 * POST /api/videos/:videoId/guest-links
 *
 * Creates a new guest link for a video. Returns the plaintext token ONCE —
 * it is never stored or logged; only the SHA-256 hash is persisted in the DB.
 *
 * GET /api/videos/:videoId/guest-links
 *
 * Lists active (non-revoked) guest links for a video. Does NOT include the
 * token hash or any token-like value — only the UUID id and metadata.
 *
 * Both methods require agent/admin_agent/owner membership in the video's agency.
 */
const GUEST_LINKS_RATE_LIMIT = 30
const GUEST_LINKS_RATE_WINDOW = 60

type AuthorizedContext = {
  admin: SupabaseClient
  video: { id: string; agency_id: string; active_version_id: string | null }
}

async function authorizeVideoAccess(
  videoId: string,
  userId: string,
  actionMessage: string
): Promise<AuthorizedContext | NextResponse> {
  const admin = createAdminClient()

  const { data: video } = await admin
    .from('videos')
    .select('id, agency_id, active_version_id')
    .eq('id', videoId)
    .single()

  if (!video) {
    return NextResponse.json({ error: 'Video not found' }, { status: 404 })
  }

  const membership = await requireAgentRole(admin, userId, video.agency_id, actionMessage)
  if (membership instanceof NextResponse) return membership

  return { admin, video }
}

export async function POST(request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[guest-links:post] Missing Supabase environment variables')
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
    `guest-links:post:user:${user.id}`,
    GUEST_LINKS_RATE_LIMIT,
    GUEST_LINKS_RATE_WINDOW,
    'guest-links:post',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  // Parse optional expires_at from body; missing/empty body is valid.
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  let expiresAt: string | null = null
  if (typeof body.expires_at === 'string') {
    const d = new Date(body.expires_at)
    if (isNaN(d.getTime())) {
      return NextResponse.json({ error: 'Invalid expires_at format' }, { status: 400 })
    }
    if (d.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'expires_at must be in the future' }, { status: 400 })
    }
    expiresAt = d.toISOString()
  }

  const ctx = await authorizeVideoAccess(videoId, user.id, 'Only agents can manage guest links')
  if (ctx instanceof NextResponse) return ctx
  const { admin, video } = ctx

  // Generate token — plaintext returned once, only hash stored in DB
  const token = generateGuestToken()
  const tokenHash = hashGuestToken(token)

  const { data: link, error: insertError } = await admin
    .from('guest_links')
    .insert({
      video_id: videoId,
      agency_id: video.agency_id,
      video_version_id: video.active_version_id ?? null,
      token_hash: tokenHash,
      created_by: user.id,
      expires_at: expiresAt,
    })
    .select('id, expires_at, created_at')
    .single()

  if (insertError || !link) {
    console.error('[guest-links:post] Failed to insert guest link:', insertError?.message)
    return NextResponse.json({ error: 'Failed to create guest link' }, { status: 500 })
  }

  const guestUrl = `${request.nextUrl.origin}/guest/${token}`

  // Audit: fire-and-forget
  const actorName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)
  logEvent({
    action: 'guest_link_created',
    resourceType: 'guest_link',
    resourceId: link.id,
    agencyId: video.agency_id,
    actorId: user.id,
    actorName,
    metadata: { video_id: videoId, expires_at: link.expires_at },
  }).catch((err) => console.error('[guest-links:post] logEvent unhandled rejection:', err))

  return NextResponse.json(
    {
      id: link.id,
      token, // plaintext — shown once, never stored
      url: guestUrl,
      expires_at: link.expires_at,
      created_at: link.created_at,
    },
    { status: 201 }
  )
}

export async function GET(request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[guest-links:get] Missing Supabase environment variables')
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
    `guest-links:get:user:${user.id}`,
    GUEST_LINKS_RATE_LIMIT,
    GUEST_LINKS_RATE_WINDOW,
    'guest-links:get',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const ctx = await authorizeVideoAccess(videoId, user.id, 'Only agents can manage guest links')
  if (ctx instanceof NextResponse) return ctx
  const { admin } = ctx

  // Fetch active (non-revoked) links only — never include token_hash
  const { data: links, error: listError } = await admin
    .from('guest_links')
    .select('id, expires_at, view_count, last_viewed_at, created_at')
    .eq('video_id', videoId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (listError) {
    console.error('[guest-links:get] Failed to list guest links:', listError.message)
    return NextResponse.json({ error: 'Failed to list guest links' }, { status: 500 })
  }

  return NextResponse.json({
    links: (links ?? []).map((l) => ({
      id: l.id,
      expires_at: l.expires_at,
      view_count: l.view_count,
      last_viewed_at: l.last_viewed_at,
      created_at: l.created_at,
      url_path: `/guest/<masked>`,
    })),
  })
}
