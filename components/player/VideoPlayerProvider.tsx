'use client'

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { useVideoPlayer } from '@/hooks/useVideoPlayer'
import type { VideoPlayerState } from '@/hooks/useVideoPlayer'
import { usePlayerShortcuts } from '@/hooks/usePlayerShortcuts'

// ---------------------------------------------------------------------------
// VideoPlayerHandle — the reactive surface exposed to comment components
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

const VideoPlayerContext = createContext<VideoPlayerHandle | null>(null)

const VideoPlayerStateContext = createContext<VideoPlayerState | null>(null)

const VideoElementRefContext = createContext<RefObject<HTMLVideoElement> | null>(null)

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useVideoPlayerContext(): VideoPlayerHandle {
  const ctx = useContext(VideoPlayerContext)
  if (!ctx) throw new Error('useVideoPlayerContext must be used inside VideoPlayerProvider')
  return ctx
}

export function useVideoPlayerState(): VideoPlayerState {
  const ctx = useContext(VideoPlayerStateContext)
  if (!ctx) throw new Error('useVideoPlayerState must be used inside VideoPlayerProvider')
  return ctx
}

export function useVideoElementRef(): RefObject<HTMLVideoElement> {
  const ctx = useContext(VideoElementRefContext)
  if (!ctx) throw new Error('useVideoElementRef must be used inside VideoPlayerProvider')
  return ctx
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface VideoPlayerProviderProps {
  children: React.ReactNode
}

export function VideoPlayerProvider({ children }: VideoPlayerProviderProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerState = useVideoPlayer(videoRef)

  const [rangeIn, setRangeIn] = useState<number | null>(null)
  const [rangeOut, setRangeOut] = useState<number | null>(null)

  // Stub — will be overridden by a future comment-at-time feature
  const openCommentAtTime = useCallback(() => {}, [])

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

  return (
    <VideoElementRefContext.Provider value={videoRef}>
      <VideoPlayerStateContext.Provider value={playerState}>
        <VideoPlayerContext.Provider value={handle}>{children}</VideoPlayerContext.Provider>
      </VideoPlayerStateContext.Provider>
    </VideoElementRefContext.Provider>
  )
}

// Re-export type for consumers
export type { VideoPlayerState }
