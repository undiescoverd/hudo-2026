'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/auth'
import { markVideoSeen } from '@/lib/comment-reads'

/**
 * Records comment_reads.last_seen_at when the video page opens, and again when
 * it closes (so comments that arrived or were posted while viewing are not
 * counted as unread afterwards). Best-effort: failures are logged, never thrown.
 */
export function useMarkVideoSeen(videoId: string, userId: string | null, enabled = true): void {
  useEffect(() => {
    if (!enabled || !userId) return
    const supabase = createClient()
    void markVideoSeen(supabase, userId, videoId)
    return () => {
      void markVideoSeen(supabase, userId, videoId)
    }
  }, [videoId, userId, enabled])
}
