import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { getStorage } from '@/lib/storage'
import { PRESIGNED_URL_EXPIRY, UPLOAD_RATE_WINDOW } from '@/lib/upload-validation'

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

  const { r2Key, r2UploadId, partNumbers } = body as Record<string, unknown>

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
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    console.error('[upload/multipart-url] Missing Supabase environment variables')
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
  if (!agencyId) {
    return NextResponse.json({ error: 'Invalid R2 key format' }, { status: 400 })
  }

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
      { error: 'Only agents and above can request upload URLs' },
      { status: 403 }
    )
  }

  // --- Generate presigned URLs for each part ---

  const storage = getStorage()

  try {
    const partUrls: { partNumber: number; url: string }[] = []
    for (const partNumber of partNumbers as number[]) {
      const url = await storage.generatePartUploadUrl(
        r2Key,
        r2UploadId,
        partNumber,
        PRESIGNED_URL_EXPIRY
      )
      partUrls.push({ partNumber, url })
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
