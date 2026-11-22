import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import { UPLOAD_RATE_WINDOW } from '@/lib/upload-validation'
import { requireUploadRole } from '@/lib/api-helpers'
import { isValidUUID } from '@/lib/validation'

const ABORT_RATE_LIMIT = 30 // abort requests per user per hour
const MAX_KEY_LENGTH = 512
const MAX_UPLOAD_ID_LENGTH = 1024

/**
 * POST /api/videos/upload/abort
 *
 * Aborts an unfinished multipart upload so its parts don't linger in R2 after the
 * client gives up. Same auth, membership and talent-ownership checks as
 * /multipart-url (the R2 key encodes {agencyId}/{videoId}/...).
 */
export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { r2Key, r2UploadId } = body as Record<string, unknown>
  if (typeof r2Key !== 'string' || !r2Key.trim()) {
    return NextResponse.json({ error: 'R2 key is required' }, { status: 400 })
  }
  if (typeof r2UploadId !== 'string' || !r2UploadId.trim()) {
    return NextResponse.json({ error: 'R2 upload ID is required' }, { status: 400 })
  }

  if (r2Key.length > MAX_KEY_LENGTH || r2UploadId.length > MAX_UPLOAD_ID_LENGTH) {
    return NextResponse.json({ error: 'Invalid R2 key or upload ID' }, { status: 400 })
  }

  // Key format: {agencyId}/{videoId}/{uploadId}.ext (see generateR2Key)
  const [agencyId, keyVideoId] = r2Key.split('/')
  if (
    !agencyId ||
    !keyVideoId ||
    !isValidUUID(agencyId) ||
    !isValidUUID(keyVideoId) ||
    !r2Key.startsWith(`${agencyId}/${keyVideoId}/`)
  ) {
    return NextResponse.json({ error: 'Invalid R2 key format' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[upload/abort] Missing Supabase environment variables')
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
      `upload:abort:user:${user.id}`,
      ABORT_RATE_LIMIT,
      UPLOAD_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(UPLOAD_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    // Fail open, as in the sibling upload routes: auth + membership are the primary controls.
    console.error('[upload/abort] Rate limit check failed, allowing request:', err)
  }

  const admin = createAdminClient()
  const membership = await requireUploadRole(
    admin,
    user.id,
    agencyId,
    'Only agents and above can abort uploads'
  )
  if (membership instanceof NextResponse) return membership

  // The key's video must exist in the key's agency; talent may only touch their own.
  const { data: video, error: videoError } = await admin
    .from('videos')
    .select('id, agency_id, talent_id')
    .eq('id', keyVideoId)
    .eq('agency_id', agencyId)
    .single()

  if (videoError || !video || video.agency_id !== agencyId) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }
  if (membership.role === 'talent' && video.talent_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    await getStorage().abortMultipartUpload(r2Key, r2UploadId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error(
      '[upload/abort] Failed to abort multipart upload:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to abort upload' }, { status: 500 })
  }
}
