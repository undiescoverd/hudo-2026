/**
 * Records that the signed-in user has seen a video's comments, so unread
 * counts (lib/talent-dashboard.ts) mean "comments newer than my last visit".
 *
 * Writes through the SESSION client: RLS (0014 comment_reads_insert_own /
 * comment_reads_update_own) only lets a user write their own row, and only
 * for a video in an agency they belong to. No service role, no new route.
 * The (user_id, video_id) row is reusable for a later "seen by" feature.
 */

// Minimal structural type so tests can stub it without the full Supabase client.
interface CommentReadsClient {
  from(table: 'comment_reads'): {
    upsert(
      row: { user_id: string; video_id: string; last_seen_at: string; updated_at: string },
      options: { onConflict: string }
    ): PromiseLike<{ error: { message: string; code?: string } | null }>
  }
}

export async function markVideoSeen(
  supabase: CommentReadsClient,
  userId: string,
  videoId: string,
  now: Date = new Date()
): Promise<{ error: string | null }> {
  const ts = now.toISOString()
  const { error } = await supabase
    .from('comment_reads')
    .upsert(
      { user_id: userId, video_id: videoId, last_seen_at: ts, updated_at: ts },
      { onConflict: 'user_id,video_id' }
    )
  if (error) {
    // 42501 = RLS reject (not a member of the video's agency): expected, not worth logging.
    if (error.code !== '42501') console.error('[comment-reads] upsert failed:', error.message)
    return { error: error.message }
  }
  return { error: null }
}
