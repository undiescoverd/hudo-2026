import * as React from 'react'

import { cn } from '@/lib/utils'

export const STATUS_PILL_STATUSES = [
  'draft',
  'pending_review',
  'in_review',
  'changes_requested',
  'approved',
] as const

export type StatusPillStatus = (typeof STATUS_PILL_STATUSES)[number]

/** Fixed labels: never change (design v3 locked decision). */
export const STATUS_PILL_LABELS: Record<StatusPillStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending review',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}

export const STATUS_PILL_CLASSES: Record<StatusPillStatus, string> = {
  draft: 'bg-status-draft-bg text-status-draft-fg',
  pending_review: 'bg-status-pending-bg text-status-pending-fg',
  in_review: 'bg-status-review-bg text-status-review-fg',
  changes_requested: 'bg-status-changes-bg text-status-changes-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
}

export function StatusPill({
  status,
  className,
}: {
  status: StatusPillStatus
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_PILL_CLASSES[status],
        className
      )}
    >
      {STATUS_PILL_LABELS[status]}
    </span>
  )
}
