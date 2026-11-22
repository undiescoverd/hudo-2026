/**
 * lib/video-status.ts
 * Shared video status types, constants, StatusBadge (renders StatusPill), and transition matrix.
 * Server-component-safe — no 'use client' directive.
 */

import React from 'react'
import type { UserRole } from '@/lib/auth'
import { StatusPill } from '@/components/ui/status-pill'

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
// Status-change guards (S5-FLOW-001)
// ---------------------------------------------------------------------------

export const NO_OPEN_COMMENTS_MESSAGE =
  'Add at least one open comment on the current version before requesting changes.'

/** Server-side rule: Changes requested needs at least one open comment. Null = allowed. */
export function statusGuardError(to: VideoStatus, openComments: number): string | null {
  if (to === 'changes_requested' && openComments < 1) return NO_OPEN_COMMENTS_MESSAGE
  return null
}

export type StatusConfirmation = { kind: 'approve_with_open' | 'leave_approved'; message: string }

/** UI-side prompts: approving with open comments warns; leaving Approved confirms. */
export function statusConfirmation(
  from: VideoStatus,
  to: VideoStatus,
  openComments: number
): StatusConfirmation | null {
  if (from === to) return null
  if (to === 'approved' && openComments > 0) {
    const noun = openComments === 1 ? 'comment is' : 'comments are'
    return {
      kind: 'approve_with_open',
      message: `${openComments} ${noun} still open. Approve anyway?`,
    }
  }
  if (from === 'approved') {
    return { kind: 'leave_approved', message: 'This video is approved. Move it out of Approved?' }
  }
  return null
}

// ---------------------------------------------------------------------------
// StatusBadge component (server-component-safe)
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: VideoStatus | string }) {
  const safeStatus: VideoStatus = isVideoStatus(status) ? status : 'draft'
  return React.createElement(StatusPill, { status: safeStatus })
}
