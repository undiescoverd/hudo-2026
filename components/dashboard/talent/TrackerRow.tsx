/**
 * TrackerRow — one video row of the talent progress tracker (layout C).
 * Server-component-safe. The title link is stretched over the row; the CTA sits above it.
 */

import React from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TalentVideo } from '@/lib/talent-dashboard'
import { getRowAction, getRowReason, getTrackerSteps } from './tracker'

const NOW_COLOUR: Record<TalentVideo['status'], { text: string; bar: string }> = {
  draft: { text: 'text-foreground', bar: 'bg-foreground' },
  pending_review: { text: 'text-foreground', bar: 'bg-status-pending-fg' },
  in_review: { text: 'text-foreground', bar: 'bg-status-review-fg' },
  changes_requested: { text: 'text-status-changes-fg', bar: 'bg-status-changes-fg' },
  approved: { text: 'text-status-approved-fg', bar: 'bg-status-approved-fg' },
}

export function TrackerRow({ video }: { video: TalentVideo }) {
  const steps = getTrackerSteps(video.status)
  const reason = getRowReason(video)
  const action = getRowAction(video)
  const now = NOW_COLOUR[video.status]
  const allApproved = video.status === 'approved'

  return (
    <li
      data-testid="tracker-row"
      className="relative grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-4 gap-y-3 border-b border-line px-4 py-3.5 last:border-b-0 hover:bg-background md:grid-cols-[132px_minmax(0,1fr)_minmax(0,480px)_150px] md:gap-5"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-stage">
        {video.thumbnail_r2_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/videos/${video.id}/thumbnail`}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-px font-mono text-[10.5px] text-white">
          v{video.latest_version}
        </span>
      </div>

      <div className="min-w-0">
        <Link
          href={`/videos/${video.id}`}
          className="block truncate font-semibold after:absolute after:inset-0 after:content-['']"
        >
          {video.title}
        </Link>
        {video.agency_name ? (
          <p className="mt-0.5 truncate text-[11.5px] text-faint">{video.agency_name}</p>
        ) : null}
        <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          {reason.emphasis && (
            <span className="font-semibold text-coral-text">{reason.emphasis}</span>
          )}
          {reason.emphasis && reason.text ? ' · ' : ''}
          {reason.text}
        </p>
      </div>

      <ol
        aria-label="Progress"
        className="col-span-2 grid grid-cols-4 gap-1 md:col-span-1 md:col-start-3"
      >
        {steps.map((step) => (
          <li
            key={step.label}
            data-state={step.state}
            className={cn(
              'flex flex-col gap-1.5 whitespace-nowrap text-[11px]',
              step.state === 'todo' && 'text-faint',
              step.state === 'done' && 'text-muted-foreground',
              step.state === 'now' && cn('font-semibold', now.text)
            )}
          >
            <span
              className={cn(
                'h-1 rounded-sm bg-surface-2',
                step.state === 'done' &&
                  (allApproved ? 'bg-status-approved-fg' : 'bg-muted-foreground'),
                step.state === 'now' && now.bar
              )}
            />
            {step.label}
          </li>
        ))}
      </ol>

      <div className="relative col-span-2 flex justify-start md:col-span-1 md:col-start-4 md:justify-end">
        {action.kind === 'none' ? (
          <span className="text-[12.5px] text-faint">{action.label}</span>
        ) : (
          <Link
            href={action.href}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'sm' }),
              'relative z-10 rounded-lg'
            )}
          >
            {action.label}
          </Link>
        )}
      </div>
    </li>
  )
}
