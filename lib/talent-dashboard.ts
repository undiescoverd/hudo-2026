/**
 * lib/talent-dashboard.ts
 * Pure query builder for the talent dashboard.
 * Returns the talent's own videos with status, unread comment count,
 * and latest version number.
 *
 * Comments are stored on video_versions (video_version_id FK), so unread
 * counts must hop through video_versions → comments. This mirrors the
 * approach used in lib/dashboard.ts.
 *
 * Note: a talent's own comments are included in their unread count.
 * This is intentional — it reflects total new activity on the video,
 * not just comments from others. A future pass can filter by user_id if needed.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { VideoStatus } from '@/lib/video-status'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TalentVideo = {
  id: string
  title: string
  status: VideoStatus
  thumbnail_r2_key: string | null
  created_at: string
  latest_version: number
  unread_count: number
}

export type GetTalentVideosParams = {
  supabase: SupabaseClient
  user_id: string
  agency_ids: string[]
}

type VideoRow = {
  id: string
  title: string
  status: string
  thumbnail_r2_key: string | null
  created_at: string
  video_versions: Array<{ id: string; version_number: number }>
}

type CommentReadRow = {
  video_id: string
  last_seen_at: string
}

type VersionCommentRow = {
  video_id: string
  comments: Array<{ id: string; created_at: string }>
}

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------

/**
 * Fetch videos owned by the talent user, with latest version number
 * and unread comment count.
 *
 * Unread count = comments where created_at > last_seen_at (from comment_reads).
 * If no comment_reads row exists for (user, video), all comments are unread.
 * Soft-deleted comments (deleted_at IS NOT NULL) are excluded.
 */
export async function getTalentVideos({
  supabase,
  user_id,
  agency_ids,
}: GetTalentVideosParams): Promise<{ data: TalentVideo[]; error: string | null }> {
  if (agency_ids.length === 0) {
    return { data: [], error: null }
  }

  // ---- 1. Fetch videos owned by this talent user --------------------------
  const { data: videoRows, error: videoError } = await supabase
    .from('videos')
    .select(
      `
      id,
      title,
      status,
      thumbnail_r2_key,
      created_at,
      video_versions!video_versions_video_id_fkey ( id, version_number )
    `
    )
    .eq('talent_id', user_id)
    .in('agency_id', agency_ids)
    .order('created_at', { ascending: false })
    .limit(100)

  if (videoError) {
    console.error('[talent-dashboard] videos query failed:', videoError)
    return { data: [], error: 'Unable to load videos right now.' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase generic return
  const rows = (videoRows ?? []) as unknown as VideoRow[]

  if (rows.length === 0) {
    return { data: [], error: null }
  }

  const videoIds = rows.map((r) => r.id)

  // ---- 2. Fetch read-markers for this user + these videos -----------------
  const { data: readRows, error: readError } = await supabase
    .from('comment_reads')
    .select('video_id, last_seen_at')
    .eq('user_id', user_id)
    .in('video_id', videoIds)

  if (readError) {
    // Non-fatal: treat all comments as unread
    console.error('[talent-dashboard] comment_reads query failed:', readError)
  }

  // Build a map: video_id → last_seen_at (ISO string)
  const readMap = new Map<string, string>()
  for (const r of (readRows ?? []) as CommentReadRow[]) {
    readMap.set(r.video_id, r.last_seen_at)
  }

  // ---- 3. Fetch non-deleted comments via video_versions -------------------
  // Comments are stored on video_versions, not videos directly.
  // We fetch video_version_id + created_at to compute unread counts.
  const { data: versionCommentRows, error: commentError } = await supabase
    .from('video_versions')
    .select('video_id, comments!inner ( id, created_at )')
    .in('video_id', videoIds)
    .is('comments.deleted_at', null)

  if (commentError) {
    // Non-fatal: return zero unread counts
    console.error('[talent-dashboard] comments query failed:', commentError)
  }

  // Build a map: video_id → all comment created_at timestamps
  const commentTimestamps = new Map<string, string[]>()
  for (const row of (versionCommentRows ?? []) as unknown as VersionCommentRow[]) {
    const existing = commentTimestamps.get(row.video_id) ?? []
    for (const c of row.comments ?? []) {
      existing.push(c.created_at)
    }
    commentTimestamps.set(row.video_id, existing)
  }

  // ---- 4. Transform rows --------------------------------------------------
  const result: TalentVideo[] = rows.map((row) => {
    const versions = row.video_versions ?? []
    const latestVersion =
      versions.length > 0 ? Math.max(...versions.map((v) => v.version_number)) : 1

    const lastSeenAt = readMap.get(row.id)
    const timestamps = commentTimestamps.get(row.id) ?? []

    let unread_count: number
    if (!lastSeenAt) {
      // No read marker → all comments are unread
      unread_count = timestamps.length
    } else {
      // Count comments created after the last_seen_at marker
      unread_count = timestamps.filter((ts) => ts > lastSeenAt).length
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status as VideoStatus,
      thumbnail_r2_key: row.thumbnail_r2_key,
      created_at: row.created_at,
      latest_version: latestVersion,
      unread_count,
    }
  })

  return { data: result, error: null }
}
