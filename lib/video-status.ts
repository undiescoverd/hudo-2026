/**
 * lib/video-status.ts
 * Shared video status types, constants, StatusBadge (renders StatusPill), and transition matrix.
 * Server-component-safe — no 'use client' directive.
 */

import React from 'react'
import type { UserRole } from '@/lib/auth'
import { StatusPill } from '@/components/ui/status-pill'
import { formatRelativeTime } from '@/lib/format-time'

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

/**
 * Rule: Changes requested needs at least one open comment. Null = allowed.
 * `openComments` null means the count is unknown (not loaded or errored): never
 * refuse on an unknown count; the server (PATCH 409) stays authoritative.
 */
export function statusGuardError(to: VideoStatus, openComments: number | null): string | null {
  if (openComments === null) return null
  if (to === 'changes_requested' && openComments < 1) return NO_OPEN_COMMENTS_MESSAGE
  return null
}

export type StatusConfirmation = { kind: 'approve_with_open' | 'leave_approved'; message: string }

/** UI-side prompts: approving with open comments warns; leaving Approved confirms. */
export function statusConfirmation(
  from: VideoStatus,
  to: VideoStatus,
  openComments: number | null
): StatusConfirmation | null {
  if (from === to) return null
  // Unknown count (null): no approve warning; leaving Approved needs no count.
  if (to === 'approved' && openComments !== null && openComments > 0) {
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

export type StatusDecision =
  | { action: 'apply' }
  | { action: 'refuse'; message: string }
  | { action: 'confirm'; confirmation: StatusConfirmation }

/** What the UI does for a chosen status: refuse, ask first, or just apply. */
export function decideStatusChange(
  from: VideoStatus,
  to: VideoStatus,
  openComments: number | null
): StatusDecision {
  const message = statusGuardError(to, openComments)
  if (message) return { action: 'refuse', message }
  const confirmation = statusConfirmation(from, to, openComments)
  return confirmation ? { action: 'confirm', confirmation } : { action: 'apply' }
}

/** actor_name falls back to the user's email when they have no full name. */
export function isEmailLike(value: string): boolean {
  return value.includes('@')
}

/** "Changed by {name}, {relative time}"; no name (or an email) reads "a team member". */
export function changedByLabel(changedBy: string | null, changedAt: string | null): string | null {
  if (!changedAt) return null
  const when = formatRelativeTime(changedAt)
  if (!when) return null
  return `Changed by ${changedBy && !isEmailLike(changedBy) ? changedBy : 'a team member'}, ${when}`
}

/** PATCH /api/videos/:id/status. Resolves on success; rejects with the server's message. */
export async function patchVideoStatus(
  videoId: string,
  status: VideoStatus,
  opts: { autoOpen?: boolean } = {}
): Promise<void> {
  let res: Response
  try {
    res = await fetch(`/api/videos/${videoId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.autoOpen ? { status, autoOpen: true } : { status }),
    })
  } catch {
    throw new Error('Could not change status. Check your connection and try again.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
}

const AUTO_OPEN_ROLES: ReadonlySet<string> = new Set(['owner', 'admin_agent', 'agent'])

/** S5-FLOW-002: agent roles opening a pending_review video flip it to in_review. */
export function shouldAutoOpen(role: string | null, status: string | null): boolean {
  return role !== null && AUTO_OPEN_ROLES.has(role) && status === 'pending_review'
}

// ---------------------------------------------------------------------------
// StatusBadge component (server-component-safe)
// ---------------------------------------------------------------------------

export function StatusBadge({ status }: { status: VideoStatus | string }) {
  const safeStatus: VideoStatus = isVideoStatus(status) ? status : 'draft'
  return React.createElement(StatusPill, { status: safeStatus })
}
