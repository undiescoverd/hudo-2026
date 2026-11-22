'use client'

/**
 * VideoTable — renders the video list as a table with row checkboxes.
 * Reuses StatusBadge from lib/video-status.ts.
 */

import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusBadge } from '@/lib/video-status'
import type { AgencyVideoRow } from '@/lib/dashboard'

type Props = {
  videos: AgencyVideoRow[]
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export function VideoTable({ videos, selectedIds, onSelectionChange }: Props) {
  const allSelected = videos.length > 0 && selectedIds.length === videos.length
  const someSelected = selectedIds.length > 0 && selectedIds.length < videos.length

  function toggleAll() {
    if (allSelected) {
      onSelectionChange([])
    } else {
      onSelectionChange(videos.map((v) => v.id))
    }
  }

  function toggleRow(id: string) {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((s) => s !== id))
    } else {
      onSelectionChange([...selectedIds, id])
    }
  }

  if (videos.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No videos found.</p>
  }

  return (
    <div className="overflow-hidden rounded-[10px] bg-surface shadow-[inset_0_0_0_1px_var(--line)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              <Checkbox
                checked={allSelected}
                // indeterminate state via data attribute
                data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              Video
            </TableHead>
            <TableHead className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              Talent
            </TableHead>
            <TableHead className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              Status
            </TableHead>
            <TableHead className="text-right text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              Comments
            </TableHead>
            <TableHead className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-faint">
              Last activity
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map((video) => {
            const isSelected = selectedIds.includes(video.id)
            return (
              <TableRow
                key={video.id}
                data-selected={isSelected}
                className={isSelected ? 'bg-surface-2' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleRow(video.id)}
                    aria-label={`Select ${video.title}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex aspect-video w-[88px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-stage">
                      {video.thumbnail_r2_key ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/videos/${video.id}/thumbnail`}
                          alt={video.title}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-faint">—</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={`/videos/${video.id}`}
                        className="line-clamp-2 text-sm font-semibold hover:underline"
                      >
                        {video.title}
                      </Link>
                      <small className="font-mono text-xs text-faint">
                        v{video.latest_version}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{video.talent_name}</TableCell>
                <TableCell>
                  <StatusBadge status={video.status} />
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {video.comment_count}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {formatDate(video.last_activity)}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
