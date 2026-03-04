'use client'

import { useCallback, useEffect, useState } from 'react'
import type { RefObject } from 'react'

export interface VideoPlayerState {
  currentTime: number
  duration: number
  playing: boolean
  volume: number
  muted: boolean
  play: () => void
  pause: () => void
  seek: (t: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleFullscreen: () => void
}

export function formatTime(seconds: number): string {
  const s = Math.floor(Math.max(0, seconds))
  const mins = Math.floor(s / 60)
  const secs = s % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
}

export function clampSeek(t: number, duration: number): number {
  return Math.min(Math.max(0, t), duration)
}

export function clampVolume(v: number): number {
  return Math.min(Math.max(0, v), 1)
}

export function useVideoPlayer(videoRef: RefObject<HTMLVideoElement>): VideoPlayerState {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolumeState] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const onTimeUpdate = () => setCurrentTime(el.currentTime)
    const onDurationChange = () => setDuration(el.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onVolumeChange = () => {
      setVolumeState(el.volume)
      setMuted(el.muted)
    }

    el.addEventListener('timeupdate', onTimeUpdate)
    el.addEventListener('durationchange', onDurationChange)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('volumechange', onVolumeChange)

    return () => {
      el.removeEventListener('timeupdate', onTimeUpdate)
      el.removeEventListener('durationchange', onDurationChange)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('volumechange', onVolumeChange)
    }
  }, [videoRef])

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => {})
  }, [videoRef])

  const pause = useCallback(() => {
    videoRef.current?.pause()
  }, [videoRef])

  const seek = useCallback(
    (t: number) => {
      const el = videoRef.current
      if (!el) return
      el.currentTime = clampSeek(t, el.duration || 0)
    },
    [videoRef]
  )

  const setVolume = useCallback(
    (v: number) => {
      const el = videoRef.current
      if (!el) return
      el.volume = clampVolume(v)
    },
    [videoRef]
  )

  const toggleMute = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    el.muted = !el.muted
  }, [videoRef])

  const toggleFullscreen = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen().catch(() => {})
    }
  }, [videoRef])

  return {
    currentTime,
    duration,
    playing,
    volume,
    muted,
    play,
    pause,
    seek,
    setVolume,
    toggleMute,
    toggleFullscreen,
  }
}
