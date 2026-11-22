/**
 * NeedsYouStrip — layout E "Needs you" strip above the video table.
 * Shows videos awaiting the agent's action (status pending_review), capped at
 * MAX_NEEDS_YOU cards with a "+N more" tail. Derived from rows the dashboard
 * already loads; no extra query.
 */

import React from 'react'
import Link from 'next/link'
import { StatusPill } from '@/components/ui/status-pill'
import type { AgencyVideoRow } from '@/lib/dashboard'

export const MAX_NEEDS_YOU = 4

export function selectNeedsYou(videos: AgencyVideoRow[]): AgencyVideoRow[] {
  return videos
    .filter((v) => v.status === 'pending_review')
    .sort((a, b) => b.last_activity.localeCompare(a.last_activity))
}

export function formatAgo(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}

export function NeedsYouStrip({ videos }: { videos: AgencyVideoRow[] }) {
  const queue = selectNeedsYou(videos)
  if (queue.length === 0) return null
  const shown = queue.slice(0, MAX_NEEDS_YOU)
  const extra = queue.length - shown.length

  return (
    <section aria-labelledby="needs-you-heading" data-testid="needs-you-strip">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 id="needs-you-heading" className="text-[15px] font-semibold">
          Needs you
        </h2>
        <span className="rounded-full bg-coral px-[7px] font-mono text-[11.5px] text-coral-on">
          {queue.length}
        </span>
        <span className="text-[12.5px] text-faint">Submitted for review, waiting on you</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[repeat(4,1fr)_auto]">
        {shown.map((v) => (
          <Link
            key={v.id}
            href={`/videos/${v.id}`}
            data-testid="needs-you-card"
            className="flex min-w-0 flex-col rounded-[10px] bg-surface p-2 pb-3 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--faint)]"
          >
            <span className="relative block aspect-video overflow-hidden rounded-lg bg-stage">
              {v.thumbnail_r2_key && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/videos/${v.id}/thumbnail`}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 font-mono text-[10.5px] text-white">
                v{v.latest_version}
              </span>
            </span>
            <span className="flex min-w-0 flex-col gap-1.5 px-1 pt-2.5">
              <b className="truncate text-[13.5px] font-semibold leading-snug">{v.title}</b>
              <span className="flex flex-col items-start gap-1.5 text-xs text-muted-foreground">
                <StatusPill status={v.status} />
                <span className="max-w-full truncate">
                  <em className="font-semibold not-italic text-coral-text">
                    Submitted {formatAgo(v.last_activity)}
                  </em>{' '}
                  · {v.talent_name}
                </span>
              </span>
            </span>
          </Link>
        ))}
        {extra > 0 && (
          <span
            data-testid="needs-you-more"
            className="grid place-items-center rounded-[10px] bg-surface px-4 text-[13px] font-medium text-coral-text shadow-[inset_0_0_0_1px_var(--line)]"
          >
            +{extra} more
          </span>
        )}
      </div>
    </section>
  )
}
