'use client'

/**
 * GuestReview — client wrapper that wires click-to-seek between the guest
 * comment list and the guest video player.
 *
 * Holds the shared <video> ref so a comment's timestamp button can seek the
 * player directly, mirroring the authed CommentPanel/VideoPlayer pattern
 * (via useVideoPlayerContext) without pulling in the authed player stack —
 * guests get no Supabase access and no player context provider.
 */

import { useCallback, useRef } from 'react'
import { GuestPlayer } from './GuestPlayer'
import { GuestComments } from './GuestComments'
import type { GuestComment } from '@/lib/guest/get-guest-metadata'

interface GuestReviewProps {
  token: string
  comments: GuestComment[]
}

export function GuestReview({ token, comments }: GuestReviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const seek = useCallback((t: number) => {
    const el = videoRef.current
    if (!el) return
    // Only clamp to duration once it's known — before `loadedmetadata`,
    // `el.duration` is NaN, and `NaN || 0` would collapse every seek to 0.
    const hasDuration = Number.isFinite(el.duration) && el.duration > 0
    el.currentTime = Math.max(0, hasDuration ? Math.min(t, el.duration) : t)
  }, [])

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Player occupies 2/3 on large screens */}
      <div className="lg:col-span-2">
        <GuestPlayer token={token} videoRef={videoRef} />
      </div>

      {/* Comments panel */}
      <div className="lg:col-span-1">
        <GuestComments comments={comments} onSeek={seek} />
      </div>
    </div>
  )
}
