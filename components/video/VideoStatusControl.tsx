'use client'

/**
 * VideoStatusControl — agent-only status control on the video page (S5-FLOW-001).
 *
 * Reads "changed by" + open-comment count from GET /api/videos/:id/status and
 * changes status through PATCH (which re-enforces every rule server-side).
 * Prompts: approving with open comments warns with the count; leaving Approved
 * asks to confirm. Changes requested with no open comments is refused.
 */

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusPill, STATUS_PILL_LABELS } from '@/components/ui/status-pill'
import {
  VIDEO_STATUSES,
  isVideoStatus,
  statusConfirmation,
  statusGuardError,
  type StatusConfirmation,
  type VideoStatus,
} from '@/lib/video-status'
import { formatRelativeTime } from '@/lib/format-time'

type StatusInfo = { changedBy: string | null; changedAt: string | null; openComments: number }

type Props = {
  videoId: string
  status: string
  /** Changes when comments change, so the open count stays fresh. */
  refreshKey?: number
  onChanged: () => void
}

export function VideoStatusControl({ videoId, status, refreshKey = 0, onChanged }: Props) {
  const [info, setInfo] = useState<StatusInfo | null>(null)
  const [pending, setPending] = useState<{ to: VideoStatus; prompt: StatusConfirmation } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current: VideoStatus = isVideoStatus(status) ? status : 'draft'

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${videoId}/status`)
      if (!res.ok) return
      setInfo((await res.json()) as StatusInfo)
    } catch (err: unknown) {
      console.error('[video-status] info fetch failed:', err)
    }
  }, [videoId])

  useEffect(() => {
    void loadInfo()
  }, [loadInfo, status, refreshKey])

  async function apply(to: VideoStatus) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/videos/${videoId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setPending(null)
        setError(body.error ?? `Could not change status (HTTP ${res.status})`)
        return
      }
      setPending(null)
      onChanged()
      void loadInfo()
    } catch {
      setError('Could not change status. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  function choose(to: VideoStatus) {
    setError(null)
    const openComments = info?.openComments ?? 0
    const guard = statusGuardError(to, openComments)
    if (guard) {
      setError(guard)
      return
    }
    const prompt = statusConfirmation(current, to, openComments)
    if (prompt) {
      setPending({ to, prompt })
      return
    }
    void apply(to)
  }

  return (
    <div data-testid="video-status-control" className="flex flex-wrap items-center gap-3">
      <StatusPill status={current} />
      <select
        aria-label="Change status"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (isVideoStatus(e.target.value)) choose(e.target.value)
        }}
        className="h-[34px] rounded-md border border-line bg-surface px-2 text-sm"
      >
        <option value="">Change status…</option>
        {VIDEO_STATUSES.filter((s) => s !== current).map((s) => (
          <option key={s} value={s}>
            {STATUS_PILL_LABELS[s]}
          </option>
        ))}
      </select>
      {info?.changedBy && info.changedAt && (
        <span className="text-xs text-faint">
          Changed by {info.changedBy}, {formatRelativeTime(info.changedAt)}
        </span>
      )}
      {error && (
        <p role="alert" className="w-full text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      {pending && (
        <div
          role="alertdialog"
          aria-label="Confirm status change"
          className="flex w-full flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2"
        >
          <p className="text-sm">{pending.prompt.message}</p>
          <Button size="sm" disabled={busy} onClick={() => void apply(pending.to)}>
            Confirm
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
