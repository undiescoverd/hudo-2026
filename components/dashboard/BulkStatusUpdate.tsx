'use client'

/**
 * BulkStatusUpdate — row selection toolbar for bulk status changes.
 *
 * UI only — the Apply button is permanently disabled.
 * TODO(S2-DASH-003): wire to PATCH /api/videos/[id]/status once that
 * endpoint is implemented. The entire bulk-apply flow is owned by DASH-003.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { VIDEO_STATUSES } from '@/lib/video-status'
import type { VideoStatus } from '@/lib/video-status'
import { useState } from 'react'

type Props = {
  selectedCount: number
}

export function BulkStatusUpdate({ selectedCount }: Props) {
  const [targetStatus, setTargetStatus] = useState<VideoStatus | ''>('')
  const noneSelected = selectedCount === 0

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {selectedCount > 0 ? `${selectedCount} selected` : 'Select rows to update'}
      </span>

      <Select
        value={targetStatus}
        onValueChange={(v) => setTargetStatus(v as VideoStatus)}
        disabled={noneSelected}
      >
        <SelectTrigger className="w-44 h-8 text-sm" disabled={noneSelected}>
          <SelectValue placeholder="Set status…" />
        </SelectTrigger>
        <SelectContent>
          {VIDEO_STATUSES.map((s) => (
            <SelectItem key={s} value={s} className="text-sm">
              {s.replace(/_/g, ' ')}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* TODO(S2-DASH-003): wire to PATCH /api/videos/[id]/status — disabled until that endpoint exists */}
      <button
        type="button"
        disabled={true}
        title="Wired in S2-DASH-003"
        className="px-3 py-1.5 text-sm rounded border bg-muted text-muted-foreground cursor-not-allowed opacity-50"
      >
        Apply
      </button>
    </div>
  )
}
