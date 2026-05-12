/**
 * lib/video-status.ts
 * Shared video status types, constants, and StatusBadge component.
 * Server-component-safe — no 'use client' directive.
 */

import React from 'react'

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const VIDEO_STATUSES = [
  'draft',
  'pending_review',
  'in_review',
  'changes_requested',
  'approved',
] as const

export type VideoStatus = (typeof VIDEO_STATUSES)[number]

/** Check if an unknown string is a valid VideoStatus. */
export function isVideoStatus(s: string): s is VideoStatus {
  return (VIDEO_STATUSES as readonly string[]).includes(s)
}

// ---------------------------------------------------------------------------
// Style map
// ---------------------------------------------------------------------------

export const STATUS_STYLES: Record<VideoStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  pending_review: 'bg-yellow-100 text-yellow-700',
  in_review: 'bg-blue-100 text-blue-700',
  changes_requested: 'bg-red-100 text-red-700',
  approved: 'bg-green-100 text-green-700',
}

// ---------------------------------------------------------------------------
// StatusBadge component (server-component-safe)
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: VideoStatus | string }) {
  const safeStatus: VideoStatus = isVideoStatus(status) ? status : 'draft'
  const cls = STATUS_STYLES[safeStatus]
  return React.createElement(
    'span',
    {
      className: `inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`,
    },
    safeStatus.replace(/_/g, ' ')
  )
}
