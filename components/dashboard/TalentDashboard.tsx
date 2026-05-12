/**
 * TalentDashboard — renders the talent's video grid.
 * Server-component-safe. Receives pre-fetched videos prop from the page.
 * Shows an empty state with upload CTA when the list is empty.
 */

import Link from 'next/link'
import { VideoCard } from './VideoCard'
import type { TalentVideo } from '@/lib/talent-dashboard'

type Props = {
  videos: TalentVideo[]
}

export function TalentDashboard({ videos }: Props) {
  if (videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <p className="text-muted-foreground text-sm max-w-xs">
          You don&apos;t have any videos yet. Upload your first video to get started.
        </p>
        <Link
          href="/upload"
          className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Upload your first video
        </Link>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {videos.map((video) => (
        <VideoCard key={video.id} video={video} />
      ))}
    </div>
  )
}
