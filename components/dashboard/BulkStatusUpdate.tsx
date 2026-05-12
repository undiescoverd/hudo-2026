'use client'

/**
 * BulkStatusUpdate — row selection toolbar for bulk status changes.
 *
 * Fires PATCH /api/videos/[id]/status for each selected video in parallel.
 * Enabled when selectedCount > 0 and a target status is chosen.
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
import { useRouter } from 'next/navigation'

type Props = {
  selectedCount: number
  videoIds?: string[]
  onComplete?: () => void
}

type ApplyResult = {
  succeeded: number
  failed: number
  errors: string[]
}

export function BulkStatusUpdate({ selectedCount, videoIds = [], onComplete }: Props) {
  const [targetStatus, setTargetStatus] = useState<VideoStatus | ''>('')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const router = useRouter()

  const noneSelected = selectedCount === 0
  const canApply = !noneSelected && targetStatus.length > 0 && !applying

  const MAX_BULK_APPLY = 20

  async function handleApply() {
    if (!canApply || targetStatus === '') return

    if (videoIds.length > MAX_BULK_APPLY) {
      setResult({
        succeeded: 0,
        failed: videoIds.length,
        errors: [
          `You can update at most ${MAX_BULK_APPLY} videos at a time. Currently selected: ${videoIds.length}`,
        ],
      })
      return
    }

    setApplying(true)
    setResult(null)

    const settled = await Promise.allSettled(
      videoIds.map((id) =>
        fetch(`/api/videos/${id}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: targetStatus }),
        }).then(async (res) => {
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string }
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
          return res.json()
        })
      )
    )

    const succeeded = settled.filter((r) => r.status === 'fulfilled').length
    const failed = settled.filter((r) => r.status === 'rejected').length
    const errors = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))

    setResult({ succeeded, failed, errors })
    setApplying(false)

    if (succeeded > 0) {
      router.refresh()
      onComplete?.()
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select rows to update'}
        </span>

        <Select
          value={targetStatus}
          onValueChange={(v) => {
            setTargetStatus(v as VideoStatus)
            setResult(null)
          }}
          disabled={noneSelected || applying}
        >
          <SelectTrigger className="w-44 h-8 text-sm" disabled={noneSelected || applying}>
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

        <button
          type="button"
          disabled={!canApply}
          onClick={handleApply}
          className={`px-3 py-1.5 text-sm rounded border transition-colors ${
            canApply
              ? 'bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer border-primary'
              : 'bg-muted text-muted-foreground cursor-not-allowed opacity-50 border-transparent'
          }`}
        >
          {applying ? 'Applying…' : 'Apply'}
        </button>
      </div>

      {result && (
        <p
          className={`text-xs ${result.failed > 0 ? 'text-red-600' : 'text-green-700'}`}
          role="status"
        >
          {result.succeeded > 0 && `${result.succeeded} updated.`}{' '}
          {result.failed > 0 &&
            `${result.failed} failed: ${result.errors.slice(0, 3).join('; ')}${result.errors.length > 3 ? '…' : ''}`}
        </p>
      )}
    </div>
  )
}
