// lib/format-time.ts
//
// Shared time-formatting helpers — single source of truth for the comment
// timestamp badges, the player readout, and relative "time ago" labels.
// Previously each of CommentItem/CommentInput/GuestComments/useVideoPlayer
// carried its own slightly different copy; consolidating here so a future
// format change (e.g. hour support) only needs to happen once.

/**
 * Format a duration in seconds as a timecode.
 *
 * - Under an hour: `m:ss` — minutes are NOT zero-padded, seconds are
 *   zero-padded to 2 digits (e.g. `0:07`, `3:05`).
 * - At/over an hour: `h:mm:ss` — both minutes and seconds are zero-padded
 *   to 2 digits (e.g. `1:00:00`, `1:23:45`).
 *
 * NaN and negative input are clamped to 0.
 */
export function formatTimecode(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const totalSeconds = Math.floor(safeSeconds)

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const secs = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  }

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * Format an ISO timestamp as a short relative label: `just now`, `${m}m ago`,
 * `${h}h ago`, or `${d}d ago`. Ported from
 * components/notifications/NotificationPanel.tsx.
 *
 * Returns an empty string if `iso` doesn't parse to a valid date (the ported
 * logic would otherwise fall through to `NaNd ago`).
 */
export function formatRelativeTime(iso: string): string {
  const parsed = new Date(iso).getTime()
  if (Number.isNaN(parsed)) return ''

  const diff = Date.now() - parsed
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
