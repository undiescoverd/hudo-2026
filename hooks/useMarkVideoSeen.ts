'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/auth'
import { markVideoSeen } from '@/lib/comment-reads'

const DEBOUNCE_MS = 1000

/**
 * Keeps comment_reads.last_seen_at current while the video page is open:
 * on mount, whenever the visible comment count changes (debounced ~1s, so
 * comments seen while viewing count as read), and when the page is hidden or
 * unloaded (pagehide / visibilitychange). Unmount writes once more as an
 * extra. Best-effort: failures are logged by markVideoSeen, never thrown.
 */
export function useMarkVideoSeen(
  videoId: string,
  userId: string | null,
  commentCount: number,
  enabled = true
): void {
  const active = enabled && !!userId
  const mark = useRef<() => void>(() => {})

  // Mount / identity change: write immediately; unmount: one more best-effort write.
  useEffect(() => {
    if (!active || !userId) return
    const supabase = createClient()
    mark.current = () => void markVideoSeen(supabase, userId, videoId)
    mark.current()
    const onHide = () => {
      if (document.visibilityState === 'hidden') mark.current()
    }
    const onPageHide = () => mark.current()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      mark.current()
    }
  }, [active, userId, videoId])

  // New comments arriving (or posted) while viewing: re-mark after a short debounce.
  const first = useRef(true)
  useEffect(() => {
    if (!active) return
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => mark.current(), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [active, commentCount])
}
