'use client'

/**
 * VideoStatusControl — agent-only status control on the video page (S5-FLOW-001).
 *
 * Reads "changed by" + open-comment count from GET /api/videos/:id/status and
 * changes status through PATCH (which re-enforces every rule server-side).
 * Prompts: approving with open comments warns with the count; leaving Approved
 * asks to confirm. The open count is for the video's current (active) version,
 * not the version being viewed. An unknown count is never treated as zero: the
 * PATCH 409 stays authoritative and its message is shown.
 */

import * as React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusPill, STATUS_PILL_LABELS } from '@/components/ui/status-pill'
import {
  VIDEO_STATUSES,
  changedByLabel,
  decideStatusChange,
  isVideoStatus,
  patchVideoStatus,
  type StatusConfirmation,
  type VideoStatus,
} from '@/lib/video-status'

export type StatusInfo = {
  changedBy: string | null
  changedAt: string | null
  openComments: number | null
}

type Props = {
  videoId: string
  status: string
  /** Changes when comments change, so the open count stays fresh (debounced). */
  refreshKey?: number
  onChanged: () => void
  /** Pre-loaded info (tests / server render). */
  initialInfo?: StatusInfo | null
}

const REFETCH_DEBOUNCE_MS = 500

export function VideoStatusControl({
  videoId,
  status,
  refreshKey = 0,
  onChanged,
  initialInfo = null,
}: Props) {
  const [info, setInfo] = useState<StatusInfo | null>(initialInfo)
  const [pending, setPending] = useState<{ to: VideoStatus; prompt: StatusConfirmation } | null>(
    null
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const hasLoaded = useRef(false)
  const messageId = useId()

  const current: VideoStatus = isVideoStatus(status) ? status : 'draft'

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch(`/api/videos/${videoId}/status`)
      if (!res.ok) return
      setInfo((await res.json()) as StatusInfo)
      hasLoaded.current = true
    } catch (err: unknown) {
      console.error('[video-status] info fetch failed:', err)
    }
  }, [videoId])

  // First load is immediate; later refreshes (status change, comments streaming in)
  // are debounced so a burst of comments never trips the GET rate limit.
  useEffect(() => {
    const t = setTimeout(() => void loadInfo(), hasLoaded.current ? REFETCH_DEBOUNCE_MS : 0)
    return () => clearTimeout(t)
  }, [loadInfo, status, refreshKey])

  // Move focus into the confirm prompt when it opens.
  useEffect(() => {
    if (pending) cancelRef.current?.focus()
  }, [pending])

  function dismiss() {
    setPending(null)
    selectRef.current?.focus()
  }

  async function apply(to: VideoStatus) {
    setBusy(true)
    setError(null)
    try {
      await patchVideoStatus(videoId, to)
      setPending(null)
      selectRef.current?.focus()
      onChanged()
    } catch (err: unknown) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not change status.')
    } finally {
      setBusy(false)
    }
  }

  function choose(to: VideoStatus) {
    setError(null)
    const decision = decideStatusChange(current, to, info?.openComments ?? null)
    if (decision.action === 'refuse') setError(decision.message)
    else if (decision.action === 'confirm') setPending({ to, prompt: decision.confirmation })
    else void apply(to)
  }

  const changed = info ? changedByLabel(info.changedBy, info.changedAt) : null

  return (
    <div data-testid="video-status-control" className="flex flex-wrap items-center gap-3">
      <StatusPill status={current} />
      <select
        ref={selectRef}
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
      {changed && <span className="text-xs text-faint">{changed}</span>}
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      {pending && (
        <div
          role="alertdialog"
          aria-label="Confirm status change"
          aria-describedby={messageId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') dismiss()
          }}
          className="flex w-full flex-wrap items-center gap-3 rounded-md border border-line bg-surface-2 px-3 py-2"
        >
          <p id={messageId} className="text-sm">
            {pending.prompt.message}
          </p>
          <Button size="sm" disabled={busy} onClick={() => void apply(pending.to)}>
            Confirm
          </Button>
          <Button ref={cancelRef} size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
