'use client'

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { PlayerControls } from './PlayerControls'
import { useSignedUrl } from '@/hooks/useSignedUrl'
import { useVideoPlayer } from '@/hooks/useVideoPlayer'

export interface VideoPlayerHandle {
  currentTime: number
  duration: number
  seek: (t: number) => void
  play: () => void
  pause: () => void
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
}

export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(function VideoPlayer(
  { videoId, versionId },
  ref
) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { url, loading, error, applyPendingUrl } = useSignedUrl(videoId, versionId)
  const playerState = useVideoPlayer(videoRef)

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

  const handle: VideoPlayerHandle = {
    currentTime: playerState.currentTime,
    duration: playerState.duration,
    seek: playerState.seek,
    play: playerState.play,
    pause: playerState.pause,
  }

  useImperativeHandle(
    ref,
    () => handle,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      playerState.currentTime,
      playerState.duration,
      playerState.seek,
      playerState.play,
      playerState.pause,
    ]
  )

  if (error) {
    return (
      <div className="flex aspect-video w-full items-center justify-center bg-black">
        <p className="text-sm text-gray-400">Failed to load video</p>
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
        />

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
