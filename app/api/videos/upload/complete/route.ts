import { createAdminClient } from '@/lib/supabase-admin'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import type { CompletedPart } from '@/lib/storage'
import { isQuotaExceededError } from '@/lib/storage-quota'
import { UPLOAD_RATE_LIMIT, UPLOAD_RATE_WINDOW } from '@/lib/upload-validation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { checkRateLimit, requireUploadRole } from '@/lib/api-helpers'
import { logEvent } from '@/lib/audit'
import { enqueueUploadNotification } from '@/lib/notifications'

/**
 * POST /api/videos/upload/complete
 *
 * Finalizes an upload after the client has put the file to R2.
 * - For multipart uploads: completes the multipart upload in R2
 * - Verifies the object exists via HeadObject
 * - Calls create_video_version() RPC via the user-scoped Supabase client
 *   (not service role) so the RPC's auth.uid() check passes
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

  const { videoId, agencyId, r2Key, fileSizeBytes, multipart, r2UploadId, parts } = body as Record<
    string,
    unknown
  >

  // --- Input validation ---

  if (typeof videoId !== 'string' || !videoId.trim()) {
    return NextResponse.json({ error: 'Video ID is required' }, { status: 400 })
  }

  if (typeof agencyId !== 'string' || !agencyId.trim()) {
    return NextResponse.json({ error: 'Agency ID is required' }, { status: 400 })
  }

  if (typeof r2Key !== 'string' || !r2Key.trim()) {
    return NextResponse.json({ error: 'R2 key is required' }, { status: 400 })
  }

  if (typeof fileSizeBytes !== 'number' || fileSizeBytes <= 0) {
    return NextResponse.json({ error: 'File size is required' }, { status: 400 })
  }

  if (multipart) {
    if (typeof r2UploadId !== 'string' || !r2UploadId.trim()) {
      return NextResponse.json(
        { error: 'R2 upload ID is required for multipart uploads' },
        { status: 400 }
      )
    }
    if (!Array.isArray(parts) || parts.length === 0) {
      return NextResponse.json(
        { error: 'Parts array is required for multipart uploads' },
        { status: 400 }
      )
    }
    for (const part of parts) {
      if (
        !part ||
        typeof part !== 'object' ||
        typeof (part as Record<string, unknown>).ETag !== 'string' ||
        typeof (part as Record<string, unknown>).PartNumber !== 'number'
      ) {
        return NextResponse.json(
          { error: 'Each part must have ETag (string) and PartNumber (number)' },
          { status: 400 }
        )
      }
    }
  }

  // --- Environment ---

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[upload/complete] Missing Supabase environment variables')
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

  // --- Rate limit: 10 complete requests per user per hour ---

  const rl = await checkRateLimit(
    `upload:complete:user:${user.id}`,
    UPLOAD_RATE_LIMIT,
    UPLOAD_RATE_WINDOW,
    'upload/complete',
    'Too many upload requests. Please try again later.'
  )
  if (rl) return rl

  // --- Membership check ---

  const admin = createAdminClient()

  const membership = await requireUploadRole(
    admin,
    user.id,
    agencyId,
    'You do not have permission to complete uploads'
  )
  if (membership instanceof NextResponse) return membership

  const { role } = membership

  // --- Verify video belongs to agency ---

  const { data: video } = await admin
    .from('videos')
    .select('id, agency_id, talent_id, status')
    .eq('id', videoId)
    .eq('agency_id', agencyId)
    .single()

  if (!video) {
    return NextResponse.json({ error: 'Video not found in this agency' }, { status: 404 })
  }

  if (role === 'talent' && video.talent_id !== user.id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // --- Bind the R2 key to this video ---
  // generateR2Key always produces `${agencyId}/${videoId}/${uploadId}.ext`, so
  // every legitimate client passes. Rejecting anything else prevents a caller
  // from completing/attaching an object under another video's (or tenant's)
  // key space via any of the storage or version-creation calls below.
  if (!r2Key.startsWith(`${agencyId}/${videoId}/`)) {
    return NextResponse.json({ error: 'R2 key does not match video' }, { status: 400 })
  }

  // --- Complete multipart upload if applicable ---

  const storage = getStorage()

  if (multipart) {
    try {
      await storage.completeMultipartUpload(r2Key, r2UploadId as string, parts as CompletedPart[])
    } catch (err) {
      console.error(
        '[upload/complete] Multipart completion failed:',
        err instanceof Error ? err.message : 'Unknown error'
      )
      return NextResponse.json({ error: 'Failed to complete multipart upload' }, { status: 500 })
    }
  }

  // --- Verify object exists in R2 ---

  let head: { contentLength: number } | null = null
  try {
    head = await storage.headObject(r2Key)
    if (!head) {
      return NextResponse.json(
        { error: 'Upload verification failed: object not found in storage' },
        { status: 400 }
      )
    }
  } catch (err) {
    console.error(
      '[upload/complete] HeadObject failed:',
      err instanceof Error ? err.message : 'Unknown error'
    )
    return NextResponse.json({ error: 'Failed to verify upload' }, { status: 500 })
  }

  // --- Authoritative quota check (atomic via row-level lock) ---
  // The presign route does a best-effort quota check; this is the authoritative one.
  // Uses actual R2 file size (head.contentLength) rather than client-declared fileSizeBytes.
  // `head` is guaranteed non-null here (early return above if null).

  const actualFileSize = head.contentLength

  const { error: quotaError } = await supabase.rpc('increment_storage_usage', {
    p_agency_id: agencyId,
    p_bytes: actualFileSize,
  })

  if (quotaError) {
    if (isQuotaExceededError(quotaError)) {
      return NextResponse.json(
        { error: 'Storage quota exceeded. Please upgrade your plan or delete unused videos.' },
        { status: 402 }
      )
    }
    console.error('[upload/complete] Quota increment failed:', {
      code: quotaError.code,
      message: quotaError.message,
      details: quotaError.details,
      hint: quotaError.hint,
    })
    return NextResponse.json({ error: 'Failed to verify storage quota' }, { status: 500 })
  }

  // --- Create video version via RPC (user-scoped client for auth.uid() check) ---

  const { data: newVersion, error: rpcError } = await supabase.rpc('create_video_version', {
    p_video_id: videoId,
    p_agency_id: agencyId,
    p_r2_key: r2Key,
    p_file_size_bytes: actualFileSize,
    p_uploaded_by: user.id,
  })

  if (rpcError) {
    console.error('[upload/complete] RPC create_video_version failed:', rpcError.message)
    // Rollback quota increment — uses user-scoped client because the
    // decrement RPC validates auth.uid() (service-role client has no JWT).
    const { error: rollbackError } = await supabase.rpc('decrement_storage_usage', {
      p_agency_id: agencyId,
      p_bytes: actualFileSize,
    })
    if (rollbackError) {
      console.error(
        '[upload/complete] CRITICAL: Quota rollback failed — usage may be inflated:',
        rollbackError.message
      )
    }
    return NextResponse.json({ error: 'Failed to create video version' }, { status: 500 })
  }

  // Audit: fire-and-forget — a logging failure must not break the upload
  const actorName =
    typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()
      ? user.user_metadata.full_name.trim()
      : (user.email ?? user.id)
  logEvent({
    action: 'version_uploaded',
    resourceType: 'video',
    resourceId: videoId,
    agencyId: agencyId as string,
    actorId: user.id,
    actorName,
    metadata: { version_id: newVersion, file_size_bytes: actualFileSize },
  }).catch((err) => console.error('[upload/complete] logEvent unhandled rejection:', err))

  // --- Talent self-upload: auto-flip draft/changes_requested -> pending_review ---
  // Mirrors canTransition() for the 'talent' role in lib/video-status.ts. Agent+
  // uploads never auto-flip (they use PATCH /status explicitly); a re-upload on
  // a video already in pending_review/in_review/approved must not regress it.
  //
  // TOCTOU guard: `video.status` was read at the top of the route, but multipart
  // completion + headObject + the quota/version RPCs take seconds — an agent may
  // have moved the video (e.g. to in_review/approved) in that window. So the
  // flip (a) re-reads the CURRENT status for both the eligibility check and the
  // audit metadata, and (b) makes the UPDATE itself conditional on the status
  // still being flippable, treating 0 matched rows as "someone raced us — don't
  // flip, don't notify".
  let flipped = false
  let currentStatus: string = video.status
  if (role === 'talent') {
    const { data: freshVideo, error: freshError } = await admin
      .from('videos')
      .select('status')
      .eq('id', videoId)
      .single()

    if (freshError || !freshVideo) {
      // Can't trust the stale status — skip the flip; the upload still succeeded.
      console.error(
        '[upload/complete] Status re-read failed — skipping auto-flip:',
        freshError?.message ?? 'no row'
      )
    } else {
      currentStatus = freshVideo.status
      if (currentStatus === 'draft' || currentStatus === 'changes_requested') {
        // Insert audit_log FIRST — if this fails, skip the flip entirely (safe
        // degradation). The upload itself must still succeed (200) either way.
        const { error: flipAuditError } = await admin.from('audit_log').insert({
          agency_id: agencyId,
          actor_id: user.id,
          actor_name: actorName,
          action: 'status_changed',
          resource_type: 'video',
          resource_id: videoId,
          metadata: { old_status: currentStatus, new_status: 'pending_review' },
        })

        if (flipAuditError) {
          console.error(
            '[upload/complete] Status auto-flip audit insert failed — skipping flip:',
            flipAuditError.message
          )
        } else {
          // Conditional update: only flip if the status is STILL flippable —
          // a concurrent transition after the audit insert leaves 0 rows matched.
          const { data: updatedRows, error: flipUpdateError } = await admin
            .from('videos')
            .update({ status: 'pending_review', updated_at: new Date().toISOString() })
            .eq('id', videoId)
            .in('status', ['draft', 'changes_requested'])
            .select('id')

          if (flipUpdateError || !updatedRows?.length) {
            // Audit row already written — log loudly so operators can reconcile.
            console.error(
              '[upload/complete] CRITICAL: audit_log written but video status update failed',
              {
                videoId,
                auditOrphan: true,
                updateError:
                  flipUpdateError?.message ?? 'status changed concurrently (0 rows matched)',
              }
            )
          } else {
            flipped = true
            enqueueUploadNotification({
              agencyId: agencyId as string,
              videoId,
              uploaderId: user.id,
            }).catch((err) =>
              console.error('[upload/complete] enqueueUploadNotification unhandled rejection:', err)
            )
          }
        }
      }
    }
  }

  return NextResponse.json({
    version: newVersion,
    videoId,
    status: flipped ? 'pending_review' : currentStatus,
  })
}
