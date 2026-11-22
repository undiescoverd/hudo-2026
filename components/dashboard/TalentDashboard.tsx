/**
 * TalentDashboard — the talent's progress tracker (v3 layout C).
 * Server-component-safe. Receives pre-fetched videos prop from the page.
 * One row per video with a 4-step stage bar, grouped into "Your move" and
 * "Everything else". Shows an empty state with upload CTA when the list is empty.
 */

import React from 'react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { TrackerRow } from './talent/TrackerRow'
import { groupTalentVideos } from './talent/tracker'
import type { TalentVideo } from '@/lib/talent-dashboard'

type Props = {
  videos: TalentVideo[]
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-line bg-background px-4 py-2.5 text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
      {children}
    </div>
  )
}

export function TalentDashboard({ videos }: Props) {
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <h2 className="text-xl font-semibold tracking-tight">Upload your first self-tape</h2>
        <p className="text-muted-foreground text-sm max-w-xs">
          You don&apos;t have any videos yet. Upload your first video to get started.
        </p>
        <Link href="/upload" className={buttonVariants({ variant: 'primary' })}>
          Upload your first video
        </Link>
      </div>
    )
  }

  const { yourMove, rest } = groupTalentVideos(videos)

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-[inset_0_0_0_1px_var(--line)]">
      {yourMove.length > 0 && (
        <section aria-label="Your move">
          <GroupLabel>Your move · {yourMove.length}</GroupLabel>
          <ul>
            {yourMove.map((video) => (
              <TrackerRow key={video.id} video={video} />
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <section aria-label={yourMove.length ? 'Everything else' : 'All videos'}>
          <GroupLabel>
            {yourMove.length ? 'Everything else' : 'All videos'} · {rest.length}
          </GroupLabel>
          <ul>
            {rest.map((video) => (
              <TrackerRow key={video.id} video={video} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
