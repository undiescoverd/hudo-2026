import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import type { CompletedPart } from '@/lib/storage'

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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[upload/complete] Missing Supabase environment variables')
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // --- Authentication ---

  const cookieStore = await cookies()
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
      },
    },
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  // --- Membership check ---

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: membership } = await admin
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('agency_id', agencyId)
    .single()

  if (!membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const agentPlusRoles = ['owner', 'admin_agent', 'agent']
  if (!agentPlusRoles.includes(membership.role)) {
    return NextResponse.json(
      { error: 'Only agents and above can complete uploads' },
      { status: 403 }
    )
  }

  // --- Verify video belongs to agency ---

  const { data: video } = await admin
    .from('videos')
    .select('id, agency_id')
    .eq('id', videoId)
    .eq('agency_id', agencyId)
    .single()

  if (!video) {
    return NextResponse.json({ error: 'Video not found in this agency' }, { status: 404 })
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

  const actualFileSize = head?.contentLength ?? fileSizeBytes

  const { error: quotaError } = await supabase.rpc('increment_storage_usage', {
    p_agency_id: agencyId,
    p_bytes: actualFileSize,
  })

  if (quotaError) {
    // P0402 = custom "quota exceeded" error code from the RPC
    if (quotaError.message?.includes('Storage quota exceeded') || quotaError.code === 'P0402') {
      return NextResponse.json(
        { error: 'Storage quota exceeded. Please upgrade your plan or delete unused videos.' },
        { status: 402 }
      )
    }
    console.error('[upload/complete] Quota increment failed:', quotaError.message)
    return NextResponse.json({ error: 'Failed to verify storage quota' }, { status: 500 })
  }

  const quotaIncremented = true

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
    // Rollback quota increment via admin client (service role bypasses auth.uid() check)
    if (quotaIncremented) {
      const { error: rollbackError } = await admin.rpc('decrement_storage_usage', {
        p_agency_id: agencyId,
        p_bytes: actualFileSize,
      })
      if (rollbackError) {
        console.error(
          '[upload/complete] CRITICAL: Quota rollback failed — usage may be inflated:',
          rollbackError.message
        )
      }
    }
    return NextResponse.json({ error: 'Failed to create video version' }, { status: 500 })
  }

  return NextResponse.json({
    version: newVersion,
    videoId,
  })
}
