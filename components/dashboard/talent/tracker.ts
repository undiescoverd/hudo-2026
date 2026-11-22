/**
 * Pure helpers for the talent progress tracker (layout C).
 * No React, so the grouping and stage mapping are unit-testable.
 */

import type { TalentVideo } from '@/lib/talent-dashboard'
import type { VideoStatus } from '@/lib/video-status'

export const TRACKER_STEPS = ['Uploaded', 'Submitted', 'In review', 'Approved'] as const

/** Index of the current step in TRACKER_STEPS for each status. */
export const STATUS_STEP: Record<VideoStatus, number> = {
  draft: 0,
  pending_review: 1,
  in_review: 2,
  changes_requested: 2,
  approved: 3,
}

export type StepState = 'done' | 'now' | 'todo'

export type TrackerStep = { label: string; state: StepState }

/** Four-step bar for a status. Step 3 reads "Changes requested" when changes are requested. */
export function getTrackerSteps(status: VideoStatus): TrackerStep[] {
  const current = STATUS_STEP[status]
  return TRACKER_STEPS.map((label, i) => ({
    label: i === 2 && status === 'changes_requested' ? 'Changes requested' : label,
    state: i < current ? 'done' : i === current ? 'now' : 'todo',
  }))
}

/** A video needs the talent when changes are requested, it is still a draft, or it has unread comments. */
export function needsTalent(video: TalentVideo): boolean {
  return video.status === 'changes_requested' || video.status === 'draft' || video.unread_count > 0
}

function rank(video: TalentVideo): number {
  if (video.status === 'changes_requested') return 0
  if (video.status === 'draft') return 1
  return 2
}

/** Split into "Your move" (most urgent first, stable otherwise) and "Everything else". */
export function groupTalentVideos(videos: TalentVideo[]): {
  yourMove: TalentVideo[]
  rest: TalentVideo[]
} {
  const yourMove = videos
    .map((v, i) => ({ v, i }))
    .filter(({ v }) => needsTalent(v))
    .sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
    .map(({ v }) => v)
  const rest = videos.filter((v) => !needsTalent(v))
  return { yourMove, rest }
}

/** The "why" line under the title. `emphasis` is rendered in coral text. */
export function getRowReason(video: TalentVideo): { emphasis?: string; text: string } {
  const n = video.unread_count
  const newComments = `${n} new comment${n === 1 ? '' : 's'}`
  switch (video.status) {
    case 'changes_requested':
      return {
        emphasis: n ? `${n} comment${n === 1 ? '' : 's'} to address` : 'Comments to address',
        text: '',
      }
    case 'draft':
      return { emphasis: 'Not submitted yet', text: '' }
    case 'pending_review':
      return { text: 'Submitted, waiting for your agent' }
    case 'in_review':
      return n
        ? { emphasis: newComments, text: 'your agent is reviewing' }
        : { text: 'Your agent is reviewing' }
    case 'approved':
      return n ? { emphasis: newComments, text: 'approved' } : { text: 'Approved, nothing to do' }
  }
}

export type RowAction =
  | { kind: 'link'; label: string; href: string }
  | { kind: 'none'; label: string }

/** Next-step CTA. Changes requested uploads the next version (which auto-submits). */
export function getRowAction(video: TalentVideo): RowAction {
  if (video.status === 'changes_requested') {
    return {
      kind: 'link',
      label: `Upload v${video.latest_version + 1}`,
      href: `/upload?videoId=${video.id}`,
    }
  }
  if (video.status === 'draft') {
    return { kind: 'link', label: 'Open to submit', href: `/videos/${video.id}` }
  }
  if (video.unread_count > 0) {
    return { kind: 'link', label: 'Read comments', href: `/videos/${video.id}` }
  }
  return {
    kind: 'none',
    label: video.status === 'approved' ? 'Done' : 'Waiting on agent',
  }
}
