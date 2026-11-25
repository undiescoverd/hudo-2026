'use client'

import { useState, useEffect, useCallback } from 'react'
import { PlayerControls } from './PlayerControls'
import { CommentTimeline } from './CommentTimeline'
import { useSignedUrl } from '@/hooks/useSignedUrl'
import { PlayerLoadError } from './PlayerLoadError'
import { isMediaFailed } from './media-failure'
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
  /** The page's version list + setter, so the error state can offer the existing switch. */
  versions?: { id: string; versionNumber: number }[]
  onVersionChange?: (versionId: string) => void
}

export function VideoLoadFailed({
  currentVersionId,
  versions,
  onRetry,
  onVersionChange,
}: {
  currentVersionId?: string
  versions?: { id: string; versionNumber: number }[]
  onRetry: () => void
  onVersionChange?: (versionId: string) => void
}) {
  const others = (versions ?? []).filter((v) => v.id !== currentVersionId)
  return (
    <PlayerLoadError
      title="This version couldn't be loaded"
      detail="Check your connection and try again."
      onRetry={onRetry}
      className="h-full rounded-[10px]"
    >
      {onVersionChange && others.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <span className="text-[12.5px] text-white/70">Or switch to</span>
          {others.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onVersionChange(v.id)}
              className="rounded-md bg-white/10 px-2.5 py-1 font-mono text-[12.5px] text-white hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral"
            >
              v{v.versionNumber}
            </button>
          ))}
        </div>
      )}
    </PlayerLoadError>
  )
}

export function VideoPlayer({
  videoId,
  versionId,
  captionsSrc,
  comments,
  onSeekToComment,
  className,
  versions,
  onVersionChange,
}: VideoPlayerProps) {
  const videoRef = useVideoElementRef()
  const playerState = useVideoPlayerState()
  const { url, loading, error, fetchUrl, applyPendingUrl } = useSignedUrl(videoId, versionId)

  // A media error (e.g. file missing in storage) is tied to the url that failed, so it clears
  // when a new url lands. The <video> stays mounted under the overlay so the renewal
  // listeners below keep working after Retry.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const mediaError = isMediaFailed(failedUrl, url)
  // Switching versions drops the old version's failure so the spinner shows while the new url loads.
  useEffect(() => {
    setFailedUrl(null)
  }, [versionId])
  const retry = useCallback(() => {
    void fetchUrl(false)
  }, [fetchUrl])

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

  return (
    <div className={className ?? 'w-full'}>
      {/* Video + controls */}
      <div className="relative w-full overflow-hidden rounded-[10px] bg-stage">
        {loading && !error && !mediaError && (
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
          onError={() => setFailedUrl(url)}
        >
          {captionsSrc && <track kind="captions" src={captionsSrc} label="Captions" default />}
        </video>

        {(error || mediaError) && (
          <div className="absolute inset-0 z-10">
            <VideoLoadFailed
              currentVersionId={versionId}
              versions={versions}
              onRetry={retry}
              onVersionChange={onVersionChange}
            />
          </div>
        )}

        {showCustomControls && url && !mediaError && !error && (
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
      {showCustomControls && comments && comments.some((c) => c.deletedAt === null) && (
        <div className="mt-3 rounded-[10px] bg-surface px-3.5 py-3 ring-1 ring-inset ring-line">
          <CommentTimeline comments={comments} onSeekToComment={onSeekToComment} />
        </div>
      )}
    </div>
  )
}
