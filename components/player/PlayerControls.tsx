'use client'

import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { formatTime } from '@/hooks/useVideoPlayer'

interface PlayerControlsProps {
  currentTime: number
  duration: number
  playing: boolean
  volume: number
  muted: boolean
  onPlay: () => void
  onPause: () => void
  onSeek: (t: number) => void
  onVolumeChange: (v: number) => void
  onToggleMute: () => void
  onFullscreen: () => void
}

export function PlayerControls({
  currentTime,
  duration,
  playing,
  volume,
  muted,
  onPlay,
  onPause,
  onSeek,
  onVolumeChange,
  onToggleMute,
  onFullscreen,
}: PlayerControlsProps) {
  return (
    <div className="flex flex-col gap-1 bg-black/80 px-3 py-2 text-white">
      {/* Scrub timeline */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-white"
        aria-label="Seek"
      />

      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          type="button"
          onClick={playing ? onPause : onPlay}
          className="flex items-center justify-center rounded hover:text-gray-300"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>

        {/* Time display */}
        <span className="font-mono text-xs tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* Mute */}
          <button
            type="button"
            onClick={onToggleMute}
            className="flex items-center justify-center rounded hover:text-gray-300"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>

          {/* Volume slider */}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="h-1 w-20 cursor-pointer accent-white"
            aria-label="Volume"
          />

          {/* Fullscreen */}
          <button
            type="button"
            onClick={onFullscreen}
            className="flex items-center justify-center rounded hover:text-gray-300"
            aria-label="Fullscreen"
          >
            <Maximize size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
