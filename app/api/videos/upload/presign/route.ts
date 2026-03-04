import { createClient } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import {
  PRESIGNED_URL_EXPIRY,
  UPLOAD_RATE_LIMIT,
  UPLOAD_RATE_WINDOW,
  calculatePartCount,
  generateR2Key,
  isMultipart,
  validateContentType,
  validateFileName,
  validateFileSize,
} from '@/lib/upload-validation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireAgentRole } from '@/lib/api-helpers'

/**
 * POST /api/videos/upload/presign
 *
 * Generates a presigned URL for direct browser-to-R2 upload.
 * If no videoId is provided, creates a new video record (status: draft).
 * Files <= 50 MB use a single presigned PUT; > 50 MB use multipart.
 *
 * Rate limited: 10 presigns per user per hour.
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

  const { videoId, agencyId, talentId, title, fileName, contentType, fileSizeBytes } =
    body as Record<string, unknown>

  // --- Input validation ---

  if (typeof agencyId !== 'string' || !agencyId.trim()) {
    return NextResponse.json({ error: 'Agency ID is required' }, { status: 400 })
  }

  if (typeof fileName !== 'string') {
    return NextResponse.json({ error: 'File name is required' }, { status: 400 })
  }
  const fileNameError = validateFileName(fileName)
  if (fileNameError) {
    return NextResponse.json({ error: fileNameError }, { status: 400 })
  }

  if (typeof contentType !== 'string') {
    return NextResponse.json({ error: 'Content type is required' }, { status: 400 })
  }
  const contentTypeError = validateContentType(contentType)
  if (contentTypeError) {
    return NextResponse.json({ error: contentTypeError }, { status: 400 })
  }

  if (typeof fileSizeBytes !== 'number') {
    return NextResponse.json({ error: 'File size is required' }, { status: 400 })
  }
  const fileSizeError = validateFileSize(fileSizeBytes)
  if (fileSizeError) {
    return NextResponse.json({ error: fileSizeError }, { status: 400 })
  }

  if (videoId !== undefined && (typeof videoId !== 'string' || !videoId.trim())) {
    return NextResponse.json({ error: 'Video ID must be a non-empty string' }, { status: 400 })
  }

  // --- Environment ---

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[upload/presign] Missing Supabase environment variables')
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

  // --- Rate limit: 10 presigns per user per hour ---

  const rl = await checkRateLimit(
    `upload:presign:user:${user.id}`,
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW,
    'upload/presign',
    'Too many upload requests. Please try again later.'
  )
  if (rl) return rl

  // --- Membership check (agent+ role required) ---

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const membership = await requireAgentRole(
    admin,
    user.id,
    agencyId,
    'Only agents and above can upload videos'
  )
  if (membership instanceof NextResponse) return membership

  // --- Quota check (best-effort; authoritative check in complete route) ---

  const { data: agency } = await admin
    .from('agencies')
    .select('storage_usage_bytes, storage_limit_bytes')
    .eq('id', agencyId)
    .single()

  if (agency && agency.storage_limit_bytes) {
    const currentUsage = agency.storage_usage_bytes ?? 0
    if (currentUsage + fileSizeBytes > agency.storage_limit_bytes) {
      return NextResponse.json(
        { error: 'Storage quota exceeded. Please upgrade your plan or delete unused videos.' },
        { status: 402 }
      )
    }
  }

  // --- Create video record if no videoId provided ---

  let resolvedVideoId = videoId as string | undefined

  if (!resolvedVideoId) {
    const videoTitle =
      typeof title === 'string' && title.trim()
        ? title.trim()
        : fileName.replace(/\.[^.]+$/, '').slice(0, 255)

    const resolvedTalentId = typeof talentId === 'string' && talentId.trim() ? talentId : user.id

    const { data: newVideo, error: videoError } = await admin
      .from('videos')
      .insert({
        agency_id: agencyId,
        talent_id: resolvedTalentId,
        title: videoTitle,
        status: 'draft',
      })
      .select('id')
      .single()

    if (videoError || !newVideo) {
      console.error('[upload/presign] Failed to create video:', videoError?.message)
      return NextResponse.json({ error: 'Failed to create video record' }, { status: 500 })
    }

    resolvedVideoId = newVideo.id
  } else {
    // Verify video exists and belongs to the agency
    const { data: existingVideo } = await admin
      .from('videos')
      .select('id, agency_id')
      .eq('id', resolvedVideoId)
      .eq('agency_id', agencyId)
      .single()

    if (!existingVideo) {
      return NextResponse.json({ error: 'Video not found in this agency' }, { status: 404 })
    }
  }

  // --- Generate presigned URL(s) ---

  // At this point resolvedVideoId is always set: either from the newly created
  // video or from the verified existing video (both branches return early on failure).
  const r2Key = generateR2Key(agencyId, resolvedVideoId as string, fileName)
  const storage = getStorage()

  try {
    if (isMultipart(fileSizeBytes)) {
      const r2UploadId = await storage.createMultipartUpload(r2Key, contentType)
      const partCount = calculatePartCount(fileSizeBytes)

      // Generate presigned URLs for the first batch of parts (up to 10)
      const initialPartCount = Math.min(partCount, 10)
      const partUrls: { partNumber: number; url: string }[] = []
      for (let i = 1; i <= initialPartCount; i++) {
        const url = await storage.generatePartUploadUrl(r2Key, r2UploadId, i, PRESIGNED_URL_EXPIRY)
        partUrls.push({ partNumber: i, url })
      }

      return NextResponse.json({
        videoId: resolvedVideoId,
        r2Key,
        multipart: true,
        r2UploadId,
        partCount,
        partUrls,
        expiresIn: PRESIGNED_URL_EXPIRY,
      })
    } else {
      const uploadUrl = await storage.generateUploadUrl(
        r2Key,
        contentType,
        fileSizeBytes,
        PRESIGNED_URL_EXPIRY
      )

      return NextResponse.json({
        videoId: resolvedVideoId,
        r2Key,
        multipart: false,
        uploadUrl,
        expiresIn: PRESIGNED_URL_EXPIRY,
      })
    }
  } catch (err) {
    console.error(
      '[upload/presign] Failed to generate presigned URL:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 })
  }
}
