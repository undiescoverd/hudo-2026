'use client'

import { useState, useEffect } from 'react'
import { PlayerControls } from './PlayerControls'
import { CommentTimeline } from './CommentTimeline'
import { useSignedUrl } from '@/hooks/useSignedUrl'
import { useVideoElementRef, useVideoPlayerState } from './VideoPlayerProvider'
import type { Comment } from '@/lib/comments'

// Re-export for backward compat — comment components import from here
export { useVideoPlayerContext } from './VideoPlayerProvider'
export type { VideoPlayerHandle } from './VideoPlayerProvider'

interface VideoPlayerProps {
  videoId: string
  versionId?: string
  captionsSrc?: string
  comments?: Comment[]
  onSeekToComment?: (commentId: string) => void
  className?: string
}

export function VideoPlayer({
  videoId,
  versionId,
  captionsSrc,
  comments,
  onSeekToComment,
  className,
}: VideoPlayerProps) {
  const videoRef = useVideoElementRef()
  const playerState = useVideoPlayerState()
  const { url, loading, error, fetchUrl, applyPendingUrl } = useSignedUrl(videoId, versionId)

  // Remove native controls and show custom controls after hydration
  const [showCustomControls, setShowCustomControls] = useState(false)
  useEffect(() => {
    setShowCustomControls(true)
  }, [])

  // Check for pending URL on timeupdate and on pause
  useEffect(() => {
    const el = videoRef.current
    if (!el) return
    const onTimeUpdate = () => applyPendingUrl(el)
    const onPause = () => applyPendingUrl(el)
    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('pause', onPause)
    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('pause', onPause)
    }
  }, [applyPendingUrl, videoRef])

  if (error) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black">
        <p className="text-sm text-gray-400">Failed to load video</p>
        <button
          type="button"
          onClick={() => fetchUrl(false)}
          className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className={className ?? 'w-full'}>
      {/* Video + controls */}
      <div className="relative w-full bg-black">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
          </div>
        )}

        {/* controls fallback before JS hydrates */}
        <video
          ref={videoRef}
          src={url ?? undefined}
          className="aspect-video w-full"
          controls={!showCustomControls}
          playsInline
        >
          {captionsSrc && <track kind="captions" src={captionsSrc} label="Captions" default />}
        </video>

        {showCustomControls && url && (
          <div className="absolute bottom-0 left-0 right-0">
            <PlayerControls
              currentTime={playerState.currentTime}
              duration={playerState.duration}
              playing={playerState.playing}
              volume={playerState.volume}
              muted={playerState.muted}
              onPlay={playerState.play}
              onPause={playerState.pause}
              onSeek={playerState.seek}
              onVolumeChange={playerState.setVolume}
              onToggleMute={playerState.toggleMute}
              onFullscreen={playerState.toggleFullscreen}
            />
          </div>
        )}
      </div>

      {/* Comment timeline bar below video */}
      {showCustomControls && comments && comments.length > 0 && (
        <CommentTimeline comments={comments} onSeekToComment={onSeekToComment} />
      )}
    </div>
  )
}
