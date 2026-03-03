import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireAgentRole, requireMembership } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024 // 2MB
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png']
const SIGNED_URL_EXPIRY_SECONDS = 900 // 15 minutes
const THUMBNAIL_UPLOAD_RATE_LIMIT = 20 // max uploads per window
const THUMBNAIL_UPLOAD_RATE_WINDOW = 3600 // 1 hour in seconds
const THUMBNAIL_GET_RATE_LIMIT = 60 // max GET requests per window
const THUMBNAIL_GET_RATE_WINDOW = 60 // 1 minute in seconds

/**
 * POST /api/videos/:videoId/thumbnail
 *
 * Upload a thumbnail image for a video. Agent+ role required.
 * Thumbnails are small enough to go through Vercel (not presigned).
 */
export async function POST(request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[thumbnail] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 20 thumbnail uploads per user per hour
  const rl = await checkRateLimit(
    `thumbnail:upload:user:${user.id}`,
    THUMBNAIL_UPLOAD_RATE_LIMIT,
    THUMBNAIL_UPLOAD_RATE_WINDOW,
    'thumbnail',
    'Too many thumbnail upload requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Fetch video and verify ownership
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Membership + agent+ role check
  const membership = await requireAgentRole(
    admin,
    user.id,
    video.agency_id,
    'Only agents and above can upload thumbnails'
  )
  if (membership instanceof NextResponse) return membership

  // Validate content type (strip parameters like charset)
  const rawContentType = request.headers.get('content-type')
  const contentType = rawContentType?.split(';')[0].trim() ?? ''
  if (!contentType || !ALLOWED_CONTENT_TYPES.includes(contentType)) {
    return NextResponse.json(
      {
        error: `Invalid content type. Allowed: ${ALLOWED_CONTENT_TYPES.join(', ')}`,
      },
      { status: 400 }
    )
  }

  // Read body and validate size
  let body: ArrayBuffer
  try {
    body = await request.arrayBuffer()
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 })
  }

  if (body.byteLength === 0) {
    return NextResponse.json({ error: 'Empty request body' }, { status: 400 })
  }

  if (body.byteLength > MAX_THUMBNAIL_SIZE) {
    return NextResponse.json(
      {
        error: `Thumbnail exceeds maximum size of ${MAX_THUMBNAIL_SIZE / 1024 / 1024}MB`,
      },
      { status: 400 }
    )
  }

  // Upload to R2
  const extension = contentType === 'image/png' ? 'png' : 'jpg'
  const r2Key = `${video.agency_id}/${videoId}/thumbnail.${extension}`

  try {
    await getStorage().putObject(r2Key, new Uint8Array(body), contentType)
  } catch (err) {
    console.error(
      '[thumbnail] R2 upload failed:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to upload thumbnail' }, { status: 500 })
  }

  // Update video record
  const { error: updateError } = await admin
    .from('videos')
    .update({ thumbnail_r2_key: r2Key })
    .eq('id', videoId)

  if (updateError) {
    console.error('[thumbnail] Failed to update video record:', updateError.message)
    return NextResponse.json({ error: 'Failed to save thumbnail' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

/**
 * GET /api/videos/:videoId/thumbnail
 *
 * Returns a signed URL for the video's thumbnail, or null if none exists.
 */
export async function GET(_request: NextRequest, { params }: { params: { videoId: string } }) {
  const { videoId } = params

  if (!isValidUUID(videoId)) {
    return NextResponse.json({ error: 'Invalid video ID format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[thumbnail] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // Rate limit: 60 thumbnail reads per user per minute
  const rl = await checkRateLimit(
    `thumbnail:get:user:${user.id}`,
    THUMBNAIL_GET_RATE_LIMIT,
    THUMBNAIL_GET_RATE_WINDOW,
    'thumbnail',
    'Too many requests. Please try again later.'
  )
  if (rl) return rl

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id, thumbnail_r2_key')
    .eq('id', videoId)
    .single()

  if (videoError || !video) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const membership = await requireMembership(admin, user.id, video.agency_id)
  if (membership instanceof NextResponse) return membership

  if (!video.thumbnail_r2_key) {
    return NextResponse.json({ url: null })
  }

  let signedUrl: string
  try {
    signedUrl = await getStorage().generateSignedUrl(
      video.thumbnail_r2_key,
      SIGNED_URL_EXPIRY_SECONDS
    )
  } catch (err) {
    console.error(
      '[thumbnail] Failed to generate signed URL:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to generate thumbnail URL' }, { status: 500 })
  }

  return NextResponse.json({
    url: signedUrl,
    expiresIn: SIGNED_URL_EXPIRY_SECONDS,
  })
}
