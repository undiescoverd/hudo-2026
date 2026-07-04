import { createAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import { PRESIGNED_URL_EXPIRY, UPLOAD_RATE_WINDOW } from '@/lib/upload-validation'
import { requireUploadRole } from '@/lib/api-helpers'

const MAX_PARTS_PER_REQUEST = 10
const MULTIPART_URL_RATE_LIMIT = 60 // 60 part-URL requests per user per hour

/**
 * POST /api/videos/upload/multipart-url
 *
 * Generates presigned PUT URLs for multipart upload parts.
 * Called when the client needs URLs for additional parts beyond the initial batch.
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

  const {
    r2Key,
    r2UploadId,
    partNumbers: rawPartNumbers,
    partNumber,
  } = body as Record<string, unknown>

  // Normalize input: accept either the documented `partNumbers` array or the
  // legacy/client-sent singular `partNumber` (see CLAUDE.md multipart bug fix —
  // the client historically sent `partNumber` while this route only accepted
  // `partNumbers`). Both shapes are supported going forward for compatibility.
  const partNumbers = rawPartNumbers ?? (partNumber !== undefined ? [partNumber] : undefined)

  // --- Input validation ---

  if (typeof r2Key !== 'string' || !r2Key.trim()) {
    return NextResponse.json({ error: 'R2 key is required' }, { status: 400 })
  }

  if (typeof r2UploadId !== 'string' || !r2UploadId.trim()) {
    return NextResponse.json({ error: 'R2 upload ID is required' }, { status: 400 })
  }

  if (!Array.isArray(partNumbers) || partNumbers.length === 0) {
    return NextResponse.json({ error: 'Part numbers array is required' }, { status: 400 })
  }

  if (partNumbers.length > MAX_PARTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Maximum ${MAX_PARTS_PER_REQUEST} parts per request` },
      { status: 400 }
    )
  }

  for (const pn of partNumbers) {
    if (typeof pn !== 'number' || !Number.isInteger(pn) || pn < 1) {
      return NextResponse.json(
        { error: 'Each part number must be a positive integer' },
        { status: 400 }
      )
    }
  }

  // --- Environment ---

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[upload/multipart-url] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // --- Authentication ---

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // --- Rate limit ---

  try {
    const { rateLimit } = await import('@/lib/redis')
    const remaining = await rateLimit(
      `upload:multipart-url:user:${user.id}`,
      MULTIPART_URL_RATE_LIMIT,
      UPLOAD_RATE_WINDOW
    )
    if (remaining === -1) {
      return NextResponse.json(
        { error: 'Too many part URL requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(UPLOAD_RATE_WINDOW) } }
      )
    }
  } catch (err) {
    // Fail open: auth + membership + role checks are the primary security controls.
    // Rate limiting is defense-in-depth; blocking all requests on Redis outage is worse.
    // This matches the established pattern in invitations/send and other endpoints.
    console.error('[upload/multipart-url] Rate limit check failed, allowing request:', err)
  }

  // --- Membership check: derive agency from the R2 key (format: {agencyId}/{videoId}/{uploadId}.ext) ---

  const agencyId = r2Key.split('/')[0]
  const keyVideoId = r2Key.split('/')[1]
  if (!agencyId || !keyVideoId) {
    return NextResponse.json({ error: 'Invalid R2 key format' }, { status: 400 })
  }

  const admin = createAdminClient()

  const membership = await requireUploadRole(
    admin,
    user.id,
    agencyId,
    'Only agents and above can request upload URLs'
  )
  if (membership instanceof NextResponse) return membership

  // Talent may only request part URLs for their own video, and only within
  // the agency encoded in the R2 key. Agent+ callers are unrestricted (as before).
  if (membership.role === 'talent') {
    const { data: video, error: videoError } = await admin
      .from('videos')
      .select('id, agency_id, talent_id')
      .eq('id', keyVideoId)
      .single()

    if (videoError || !video || video.talent_id !== user.id || video.agency_id !== agencyId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }
  }

  // --- Generate presigned URLs for each part ---

  const storage = getStorage()

  try {
    const partUrls: { partNumber: number; url: string }[] = []
    for (const pn of partNumbers as number[]) {
      const url = await storage.generatePartUploadUrl(r2Key, r2UploadId, pn, PRESIGNED_URL_EXPIRY)
      partUrls.push({ partNumber: pn, url })
    }

    return NextResponse.json({ partUrls, expiresIn: PRESIGNED_URL_EXPIRY })
  } catch (err) {
    console.error(
      '[upload/multipart-url] Failed to generate part URLs:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to generate part upload URLs' }, { status: 500 })
  }
}
