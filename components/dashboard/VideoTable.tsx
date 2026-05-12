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
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={allSelected}
                // indeterminate state via data attribute
                data-state={someSelected ? 'indeterminate' : allSelected ? 'checked' : 'unchecked'}
                onCheckedChange={toggleAll}
                aria-label="Select all"
              />
            </TableHead>
            <TableHead className="w-16">Thumb</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Talent</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Comments</TableHead>
            <TableHead>Last activity</TableHead>
            <TableHead className="text-right">Version</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {videos.map((video) => {
            const isSelected = selectedIds.includes(video.id)
            return (
              <TableRow
                key={video.id}
                data-selected={isSelected}
                className={isSelected ? 'bg-muted/50' : ''}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleRow(video.id)}
                    aria-label={`Select ${video.title}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="w-14 h-9 rounded overflow-hidden bg-muted flex items-center justify-center flex-shrink-0">
                    {video.thumbnail_r2_key ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/videos/${video.id}/thumbnail`}
                        alt={video.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-muted-foreground text-[10px]">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    href={`/videos/${video.id}`}
                    className="font-medium text-sm hover:underline line-clamp-2"
                  >
                    {video.title}
                  </Link>
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
                <TableCell className="text-right text-sm tabular-nums">
                  v{video.latest_version}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
