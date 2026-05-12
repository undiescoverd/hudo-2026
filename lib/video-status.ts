/**
 * lib/video-status.ts
 * Shared video status types, constants, StatusBadge component, and transition matrix.
 * Server-component-safe — no 'use client' directive.
 */

import React from 'react'
import type { UserRole } from '@/lib/auth'

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
// Transition matrix
// ---------------------------------------------------------------------------

/**
 * Transition matrix for video status changes.
 *
 * Rules:
 *  - Same status → same status is always false (no-op).
 *  - Talent: can only set `pending_review`, and only from `draft` or `changes_requested`.
 *  - Agent+ (owner, admin_agent, agent): any transition between valid statuses.
 */
export function canTransition(from: VideoStatus, to: VideoStatus, role: UserRole): boolean {
  // No-op: same → same is never a valid transition
  if (from === to) return false

  if (role === 'talent') {
    // Talent may only submit for review, and only from a state where that makes sense
    return to === 'pending_review' && (from === 'draft' || from === 'changes_requested')
  }

  // Agents (owner | admin_agent | agent): any transition between valid statuses is allowed
  return true
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
