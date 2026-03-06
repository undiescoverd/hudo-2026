'use client'

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PlayerControls } from './PlayerControls'
import { useSignedUrl } from '@/hooks/useSignedUrl'
import { useVideoPlayer } from '@/hooks/useVideoPlayer'
import { usePlayerShortcuts } from '@/hooks/usePlayerShortcuts'

export interface VideoPlayerHandle {
  currentTime: number
  duration: number
  seek: (t: number) => void
  play: () => void
  pause: () => void
  rangeIn: number | null
  rangeOut: number | null
  setRangeIn: (t: number | null) => void
  setRangeOut: (t: number | null) => void
  openCommentAtTime: () => void
}

const VideoPlayerContext = createContext<VideoPlayerHandle | null>(null)

export function useVideoPlayerContext(): VideoPlayerHandle {
  const ctx = useContext(VideoPlayerContext)
  if (!ctx) throw new Error('useVideoPlayerContext must be used inside VideoPlayer')
  return ctx
}

interface VideoPlayerProps {
  videoId: string
  versionId?: string
  captionsSrc?: string
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { videoId, versionId, captionsSrc },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { url, loading, error, fetchUrl, applyPendingUrl } = useSignedUrl(videoId, versionId)
  const playerState = useVideoPlayer(videoRef)

  const [rangeIn, setRangeIn] = useState<number | null>(null)
  const [rangeOut, setRangeOut] = useState<number | null>(null)

  // Stub — will be overridden by PLAYER-003 via a ref callback
  const openCommentAtTime = useCallback(() => {}, [])

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
  }, [applyPendingUrl])

  const handlePlayPause = useCallback(() => {
    if (playerState.playing) {
      playerState.pause()
    } else {
      playerState.play()
    }
  }, [playerState])

  const handleRangeIn = useCallback(() => {
    setRangeIn(playerState.currentTime)
  }, [playerState.currentTime])

  const handleRangeOut = useCallback(() => {
    setRangeOut(playerState.currentTime)
  }, [playerState.currentTime])

  const handleClearRange = useCallback(() => {
    setRangeIn(null)
    setRangeOut(null)
  }, [])

  usePlayerShortcuts({
    onPlayPause: handlePlayPause,
    onCommentAtTime: openCommentAtTime,
    onRangeIn: handleRangeIn,
    onRangeOut: handleRangeOut,
    onClearRange: handleClearRange,
  })

  const handle = useMemo<VideoPlayerHandle>(
    () => ({
      currentTime: playerState.currentTime,
      duration: playerState.duration,
      seek: playerState.seek,
      play: playerState.play,
      pause: playerState.pause,
      rangeIn,
      rangeOut,
      setRangeIn,
      setRangeOut,
      openCommentAtTime,
    }),
    [
      playerState.currentTime,
      playerState.duration,
      playerState.seek,
      playerState.play,
      playerState.pause,
      rangeIn,
      rangeOut,
      openCommentAtTime,
    ]
  )

  useImperativeHandle(ref, () => handle, [handle])

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
    <VideoPlayerContext.Provider value={handle}>
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
    </VideoPlayerContext.Provider>
  )
})
