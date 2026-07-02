'use client'

/**
 * AgentDashboard — client wrapper that holds filter/search/selection state.
 * Receives initialVideos from the server component; on filter change it
 * fetches updated results from GET /api/dashboard/videos.
 *
 * Error convention: the initial-load error case is owned by the server
 * component (`app/(dashboard)/dashboard/page.tsx` renders the shared
 * <DashboardError /> instead of mounting this component at all). This
 * component only owns errors from its own client-side filter/search
 * fetches, surfaced inline near the filter controls with a retry action.
 */

import { useState, useCallback, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { VideoTable } from '@/components/dashboard/VideoTable'
import { StatusFilter } from '@/components/dashboard/StatusFilter'
import { BulkStatusUpdate } from '@/components/dashboard/BulkStatusUpdate'
import type { AgencyVideoRow } from '@/lib/dashboard'
import type { VideoStatus } from '@/lib/video-status'

type Props = {
  initialVideos: AgencyVideoRow[]
}

const FILTER_FETCH_ERROR_MESSAGE = "Couldn't update the video list. Please try again."

export function AgentDashboard({ initialVideos }: Props) {
  const [videos, setVideos] = useState<AgencyVideoRow[]>(initialVideos)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<VideoStatus[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const fetchVideos = useCallback((statuses: VideoStatus[], q: string) => {
    startTransition(async () => {
      const params = new URLSearchParams()
      if (statuses.length > 0) params.set('status', statuses.join(','))
      if (q.trim()) params.set('q', q.trim())

      try {
        const res = await fetch(`/api/dashboard/videos?${params.toString()}`)
        if (res.ok) {
          const json = (await res.json()) as { data: AgencyVideoRow[] }
          setVideos(json.data)
          setFetchError(null)
          // Clear selection on filter change
          setSelectedIds([])
        } else {
          console.error('[AgentDashboard] fetch failed with status', res.status)
          setFetchError(FILTER_FETCH_ERROR_MESSAGE)
        }
      } catch (err) {
        console.error('[AgentDashboard] fetch error', err)
        setFetchError(FILTER_FETCH_ERROR_MESSAGE)
      }
    })
  }, [])

  function handleStatusChange(statuses: VideoStatus[]) {
    setStatusFilter(statuses)
    fetchVideos(statuses, searchQuery)
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value
    setSearchQuery(q)
    fetchVideos(statusFilter, q)
  }

  function handleRetry() {
    fetchVideos(statusFilter, searchQuery)
  }

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <Input
          type="search"
          placeholder="Search title…"
          value={searchQuery}
          onChange={handleSearchChange}
          className="max-w-xs h-8 text-sm"
        />
        <StatusFilter selected={statusFilter} onChange={handleStatusChange} />
      </div>

      {/* Filter-fetch error — initial-load errors are handled by the server
          component instead; this only fires for client-side refetches. */}
      {fetchError && (
        <div className="flex items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm text-destructive" role="alert">
            {fetchError}
          </p>
          <button
            type="button"
            onClick={handleRetry}
            className="shrink-0 rounded-md bg-destructive/10 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/20"
          >
            Retry
          </button>
        </div>
      )}

      {/* Bulk actions row */}
      <BulkStatusUpdate
        selectedCount={selectedIds.length}
        videoIds={selectedIds}
        onComplete={() => setSelectedIds([])}
      />

      {/* Table */}
      <div className={isPending ? 'opacity-60 pointer-events-none' : ''}>
        <VideoTable videos={videos} selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
      </div>

      {isPending && <p className="text-xs text-muted-foreground text-center py-2">Loading…</p>}
    </div>
  )
}
