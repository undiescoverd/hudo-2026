/**
 * VideoCard — single video card for the talent dashboard.
 * Server-component-safe (no client hooks). Purely presentational.
 * Whole card is a Link to /videos/[id].
 */

import Link from 'next/link'
import { StatusBadge } from '@/lib/video-status'
import type { TalentVideo } from '@/lib/talent-dashboard'

type Props = {
  video: TalentVideo
}

export function VideoCard({ video }: Props) {
  return (
    <Link
      href={`/videos/${video.id}`}
      className="group block border rounded-lg overflow-hidden hover:border-foreground/30 transition-colors"
    >
      {/* Thumbnail */}
      <div className="aspect-video bg-muted flex items-center justify-center relative">
        {video.thumbnail_r2_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/videos/${video.id}/thumbnail`}
            alt={video.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-muted-foreground text-xs">No thumbnail</span>
        )}

        {/* Unread badge — shown only when unread_count > 0 */}
        {video.unread_count > 0 && (
          <span className="absolute top-2 right-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-600 text-white">
            {video.unread_count} new
          </span>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 space-y-1">
        <p className="text-sm font-medium line-clamp-1 group-hover:text-foreground transition-colors">
          {video.title}
        </p>
        <div className="flex items-center gap-2">
          <StatusBadge status={video.status} />
          <span className="text-xs text-muted-foreground">v{video.latest_version}</span>
        </div>
      </div>
    </Link>
  )
}
