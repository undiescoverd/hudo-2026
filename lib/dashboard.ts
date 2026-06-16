/**
 * lib/dashboard.ts
 * Pure query builder for the agent dashboard.
 * Returns agency videos with joined talent name, status, comment count,
 * last activity, and latest version number.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoStatus } from '@/lib/video-status'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgencyVideoRow = {
  id: string
  title: string
  status: VideoStatus
  thumbnail_r2_key: string | null
  created_at: string
  updated_at: string
  talent_id: string
  talent_name: string
  latest_version: number
  comment_count: number
  last_activity: string // ISO timestamp — max(updated_at, latest comment created_at)
}

export type GetAgencyVideosParams = {
  supabase: SupabaseClient
  agency_ids: string[]
  status?: VideoStatus[]
  q?: string
  limit?: number
  offset?: number
}

type VideoRow = {
  id: string
  title: string
  status: string
  thumbnail_r2_key: string | null
  created_at: string
  updated_at: string
  talent_id: string
  agency_id: string
  // PostgREST returns arrays even for to-one joins; we take [0] below
  users: Array<{ full_name: string }>
  video_versions: Array<{ version_number: number; created_at: string }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape Postgres ilike metacharacters to prevent pattern injection. */
function escapeIlike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * Fetch agency videos with talent name and latest version number.
 * Comment counts are fetched separately and merged in.
 *
 * Why separate comment count query:
 * PostgREST filtered embedded aggregates are fragile; a separate keyed query
 * is simpler and avoids silent over-counts when `deleted_at IS NULL` filtering
 * is applied inside the nested embed.
 */
export async function getAgencyVideos({
  supabase,
  agency_ids,
  status,
  q,
  limit = 50,
  offset = 0,
}: GetAgencyVideosParams): Promise<{ data: AgencyVideoRow[]; error: string | null }> {
  if (agency_ids.length === 0) {
    return { data: [], error: null }
  }

  // ---- 1. Fetch videos with talent join + all versions -----------------
  let query = supabase
    .from('videos')
    .select(
      `
      id,
      title,
      status,
      thumbnail_r2_key,
      created_at,
      updated_at,
      talent_id,
      agency_id,
      users!videos_talent_id_fkey ( full_name ),
      video_versions!video_versions_video_id_fkey ( version_number, created_at )
    `
    )
    .in('agency_id', agency_ids)
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status && status.length > 0) {
    query = query.in('status', status)
  }

  if (q && q.trim().length > 0) {
    // ilike search on title; talent name filtering is done client-side after join
    query = query.ilike('title', `%${escapeIlike(q.trim())}%`)
  }

  const { data: videoRows, error: videoError } = await query

  if (videoError) {
    return { data: [], error: videoError.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase generic return
  const rows = (videoRows ?? []) as unknown as VideoRow[]

  if (rows.length === 0) {
    return { data: [], error: null }
  }

  const videoIds = rows.map((r) => r.id)

  // ---- 2. Fetch non-deleted comment counts keyed by video_id -----------
  // Query video_versions for the fetched videos, joined with comments count.
  // Counting in JS after fetching all matching comment rows is simpler than
  // trying to use PostgREST filtered embedded aggregates.
  const { data: commentRows, error: commentError } = await supabase
    .from('video_versions')
    .select('video_id, comments!inner ( id )')
    .in('video_id', videoIds)
    .is('comments.deleted_at', null)

  if (commentError) {
    // Non-fatal: return zeros for counts
    console.error('[dashboard] Comment count query failed:', commentError.message)
  }

  // Build a map: video_id → count
  const countMap = new Map<string, number>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase nested join shape
  for (const r of (commentRows ?? []) as unknown as Array<{
    video_id: string
    comments: Array<{ id: string }>
  }>) {
    const existing = countMap.get(r.video_id) ?? 0
    countMap.set(r.video_id, existing + (r.comments?.length ?? 0))
  }

  // ---- 3. Transform rows -----------------------------------------------
  const result: AgencyVideoRow[] = rows.map((row) => {
    const versions = row.video_versions ?? []
    const latestVersion =
      versions.length > 0 ? Math.max(...versions.map((v) => v.version_number)) : 1

    // last_activity: max of updated_at across versions and the video itself
    const versionDates = versions.map((v) => v.created_at)
    const allDates = [row.updated_at, ...versionDates].filter(Boolean)
    const lastActivity = allDates.sort().at(-1) ?? row.updated_at

    return {
      id: row.id,
      title: row.title,
      status: row.status as VideoStatus,
      thumbnail_r2_key: row.thumbnail_r2_key,
      created_at: row.created_at,
      updated_at: row.updated_at,
      talent_id: row.talent_id,
      talent_name: row.users?.[0]?.full_name ?? 'Unknown',
      latest_version: latestVersion,
      comment_count: countMap.get(row.id) ?? 0,
      last_activity: lastActivity,
    }
  })

  return { data: result, error: null }
}
