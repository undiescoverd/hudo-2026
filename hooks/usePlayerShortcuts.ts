'use client'

import { useEffect } from 'react'

export interface PlayerShortcutsOptions {
  onPlayPause: () => void
  onCommentAtTime: () => void
  onRangeIn: () => void
  onRangeOut: () => void
  onClearRange: () => void
}

export type PlayerShortcutAction =
  | 'playPause'
  | 'commentAtTime'
  | 'rangeIn'
  | 'rangeOut'
  | 'clearRange'

/** The slice of an Element the Space check reads (so it can be tested without a DOM). */
interface ElementLike {
  tagName?: string
  getAttribute?: (name: string) => string | null
}

/**
 * True for elements that Space activates or edits natively: buttons, links, selects,
 * <summary>, role="button" and contenteditable hosts. Space must reach them instead
 * of toggling playback (calling preventDefault on it also stops a Chromium button
 * from activating).
 */
export function isSpaceInteractive(target: EventTarget | null): boolean {
  const el = target as ElementLike | null
  if (!el || typeof el.tagName !== 'string') return false
  const attr = (name: string) => el.getAttribute?.(name) ?? null
  const tag = el.tagName.toUpperCase()
  return (
    tag === 'BUTTON' ||
    tag === 'SELECT' ||
    tag === 'SUMMARY' ||
    (tag === 'A' && attr('href') !== null) ||
    attr('role') === 'button' ||
    attr('contenteditable') === 'true'
  )
}

/**
 * Which player shortcut a keydown triggers, or null to leave the key alone. Typing
 * in an input or textarea never triggers one. Space (only) also yields to the
 * interactive element it was pressed on.
 */
export function playerShortcutFor(event: {
  key: string
  target: EventTarget | null
  activeTag?: string
}): PlayerShortcutAction | null {
  const tag = (event.activeTag ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA') return null

  if (event.key === ' ') return isSpaceInteractive(event.target) ? null : 'playPause'

  switch (event.key.toLowerCase()) {
    case 'c':
      return 'commentAtTime'
    case 'i':
      return 'rangeIn'
    case 'o':
      return 'rangeOut'
    case 'x':
      return 'clearRange'
    default:
      return null
  }
}

export function usePlayerShortcuts(options: PlayerShortcutsOptions): void {
  const { onPlayPause, onCommentAtTime, onRangeIn, onRangeOut, onClearRange } = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = playerShortcutFor({
        key: e.key,
        target: e.target,
        activeTag: document.activeElement?.tagName,
      })

      if (action === 'playPause') {
        e.preventDefault()
        onPlayPause()
      } else if (action === 'commentAtTime') {
        onCommentAtTime()
      } else if (action === 'rangeIn') {
        onRangeIn()
      } else if (action === 'rangeOut') {
        onRangeOut()
      } else if (action === 'clearRange') {
        onClearRange()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onPlayPause, onCommentAtTime, onRangeIn, onRangeOut, onClearRange])
}
