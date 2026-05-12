/**
 * GET /api/dashboard/videos
 *
 * Returns agency videos for the agent dashboard.
 * Requires authenticated user with role in {owner, admin_agent, agent}.
 *
 * Query params:
 *   status  — comma-separated list of VideoStatus values (optional)
 *   q       — search string for title (optional)
 *   limit   — page size (default 50, max 100)
 *   offset  — pagination offset (default 0)
 */

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { getAgencyVideos } from '@/lib/dashboard'
import { isVideoStatus, VIDEO_STATUSES } from '@/lib/video-status'
import type { VideoStatus } from '@/lib/video-status'

const AGENT_PLUS_ROLES = new Set(['owner', 'admin_agent', 'agent'])

export async function GET(req: NextRequest) {
  // ---- Auth ---------------------------------------------------------------
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { user, role, agency_ids } = await getCurrentUserRole(supabase)

  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  if (!AGENT_PLUS_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (agency_ids.length === 0) {
    return NextResponse.json({ data: [] })
  }

  // ---- Parse query params -------------------------------------------------
  const { searchParams } = req.nextUrl

  const rawStatus = searchParams.get('status')
  let statusFilter: VideoStatus[] | undefined
  if (rawStatus) {
    const parts = rawStatus.split(',').map((s) => s.trim())
    const valid = parts.filter(isVideoStatus) as VideoStatus[]
    // If caller passes unknown statuses, ignore those silently
    if (valid.length > 0) statusFilter = valid
  }

  const q = searchParams.get('q') ?? undefined

  const rawLimit = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit = Number.isNaN(rawLimit) ? 50 : Math.min(Math.max(1, rawLimit), 100)

  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10)
  const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset)

  // ---- Data ---------------------------------------------------------------
  const { data, error } = await getAgencyVideos({
    supabase,
    agency_ids,
    status: statusFilter,
    q,
    limit,
    offset,
  })

  if (error) {
    console.error('[dashboard/videos] Query error:', error)
    return NextResponse.json({ error: 'Failed to fetch videos' }, { status: 500 })
  }

  return NextResponse.json({ data, statuses: VIDEO_STATUSES })
}
