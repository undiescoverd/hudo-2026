'use client'

/**
 * StatusFilter — multi-select filter for video statuses.
 * Uses a simple checkbox group (shadcn Checkbox).
 */

import { Checkbox } from '@/components/ui/checkbox'
import { VIDEO_STATUSES, STATUS_STYLES } from '@/lib/video-status'
import type { VideoStatus } from '@/lib/video-status'

type Props = {
  selected: VideoStatus[]
  onChange: (statuses: VideoStatus[]) => void
}

export function StatusFilter({ selected, onChange }: Props) {
  function toggle(status: VideoStatus) {
    if (selected.includes(status)) {
      onChange(selected.filter((s) => s !== status))
    } else {
      onChange([...selected, status])
    }
  }

  return (
    <div className="flex flex-wrap gap-3 items-center">
      <span className="text-sm text-muted-foreground font-medium">Status:</span>
      {VIDEO_STATUSES.map((status) => {
        const id = `status-filter-${status}`
        return (
          <div key={status} className="flex items-center gap-1.5">
            <Checkbox
              id={id}
              checked={selected.includes(status)}
              onCheckedChange={() => toggle(status)}
            />
            <label htmlFor={id} className="cursor-pointer">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}
              >
                {status.replace(/_/g, ' ')}
              </span>
            </label>
          </div>
        )
      })}
    </div>
  )
}
