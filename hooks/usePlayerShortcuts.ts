'use client'

import { useEffect } from 'react'

export interface PlayerShortcutsOptions {
  onPlayPause: () => void
  onCommentAtTime: () => void
  onRangeIn: () => void
  onRangeOut: () => void
  onClearRange: () => void
}

export function usePlayerShortcuts(options: PlayerShortcutsOptions): void {
  const { onPlayPause, onCommentAtTime, onRangeIn, onRangeOut, onClearRange } = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase()
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      const key = e.key.toLowerCase()

      if (e.key === ' ') {
        e.preventDefault()
        onPlayPause()
        return
      }

      if (key === 'c') {
        onCommentAtTime()
        return
      }

      if (key === 'i') {
        onRangeIn()
        return
      }

      if (key === 'o') {
        onRangeOut()
        return
      }

      if (key === 'x') {
        onClearRange()
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onPlayPause, onCommentAtTime, onRangeIn, onRangeOut, onClearRange])
}
