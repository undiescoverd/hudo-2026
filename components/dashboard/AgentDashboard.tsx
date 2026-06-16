'use client'

/**
 * AgentDashboard — client wrapper that holds filter/search/selection state.
 * Receives initialVideos from the server component; on filter change it
 * fetches updated results from GET /api/dashboard/videos.
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
  error?: string | null
}

export function AgentDashboard({ initialVideos, error }: Props) {
  const [videos, setVideos] = useState<AgencyVideoRow[]>(initialVideos)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<VideoStatus[]>([])
  const [searchQuery, setSearchQuery] = useState('')
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
          // Clear selection on filter change
          setSelectedIds([])
        }
      } catch (err) {
        console.error('[AgentDashboard] fetch error', err)
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

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Couldn&apos;t load videos right now. Please try again later.
      </p>
    )
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
