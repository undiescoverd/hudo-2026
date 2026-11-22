'use client'

import { useEffect, useState } from 'react'

/** One earlier version that still has open (unresolved, non-deleted) comments. */
export interface EarlierOpen {
  versionId: string
  versionNumber: number
  openCount: number
}

/** "1 open comment on v1" / "4 open comments on v1". */
export function earlierOpenLabel(n: EarlierOpen): string {
  return `${n.openCount} open comment${n.openCount === 1 ? '' : 's'} on v${n.versionNumber}`
}

/** One slim note per earlier version with open comments; renders nothing when there are none. */
export function EarlierOpenNotes({
  notes,
  onSelect,
}: {
  notes: EarlierOpen[]
  onSelect: (versionId: string) => void
}) {
  if (notes.length === 0) return null
  return (
    <div
      role="group"
      aria-label="Open comments on earlier versions"
      className="flex flex-wrap items-center gap-2"
    >
      {notes.map((n) => (
        <button
          key={n.versionId}
          type="button"
          data-testid="earlier-open-note"
          onClick={() => onSelect(n.versionId)}
          className="rounded-md bg-coral-soft px-2.5 py-1 text-[13px] font-medium text-coral-text hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral"
        >
          {earlierOpenLabel(n)}
        </button>
      ))}
    </div>
  )
}

export interface Version {
  id: string
  versionNumber: number
  fileSizeBytes: number
  uploadedBy: string
  createdAt: string
}

interface VersionSelectorProps {
  videoId: string
  activeVersionId: string | null
  onVersionChange: (versionId: string) => void
  /**
   * Optional pre-fetched versions list, for callers that already hit
   * GET /api/videos/:id/versions themselves (e.g. the video page also needs
   * `agencyId` from that same response). Semantics:
   *  - omitted (undefined): uncontrolled — VersionSelector fetches its own data
   *  - null: controlled, still loading — show the loading state, skip the fetch
   *  - array: controlled, loaded — render directly, skip the fetch
   */
  versions?: Version[] | null
}

export function VersionSelector({
  videoId,
  activeVersionId,
  onVersionChange,
  versions: controlledVersions,
}: VersionSelectorProps) {
  const isControlled = controlledVersions !== undefined
  const [fetchedVersions, setFetchedVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(!isControlled)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isControlled) return
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/videos/${videoId}/versions`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load versions (${res.status})`)
        return res.json() as Promise<{ versions: Version[] }>
      })
      .then(({ versions: fetched }) => {
        if (!cancelled) {
          setFetchedVersions(fetched)
          // Auto-select the latest version (first in list, descending order) if nothing selected
          if (!activeVersionId && fetched.length > 0) {
            onVersionChange(fetched[0].id)
          }
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load versions')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, isControlled])

  // Controlled mode: auto-select the latest version as soon as the caller's
  // data arrives (mirrors the uncontrolled-mode auto-select above).
  useEffect(() => {
    if (isControlled && controlledVersions && !activeVersionId && controlledVersions.length > 0) {
      onVersionChange(controlledVersions[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, controlledVersions, activeVersionId])

  // Open comments left behind on earlier versions, for the active version. Comments are
  // never copied between versions, so this keeps unresolved feedback from being lost.
  // Counted server-side (auth + access checked there); a failure just shows no note.
  const [earlierOpen, setEarlierOpen] = useState<EarlierOpen[]>([])
  useEffect(() => {
    // Keep the previous notes until the new response lands (no flicker on version switch).
    if (!activeVersionId) {
      setEarlierOpen([])
      return
    }
    let cancelled = false
    fetch(`/api/videos/${videoId}/versions/${activeVersionId}/comments?earlierOpen=1`)
      .then((res) => (res.ok ? (res.json() as Promise<{ earlierOpen: EarlierOpen[] }>) : null))
      .then((data) => {
        if (!cancelled) setEarlierOpen(data?.earlierOpen ?? [])
      })
      .catch(() => {
        if (!cancelled) setEarlierOpen([])
      })
    return () => {
      cancelled = true
    }
  }, [videoId, activeVersionId])

  const versions = isControlled ? (controlledVersions ?? []) : fetchedVersions
  const isLoading = isControlled ? controlledVersions === null : loading

  if (isLoading) {
    return (
      <div className="flex items-center gap-2" aria-label="Loading versions">
        {[1, 2].map((i) => (
          <div key={i} className="h-8 w-10 animate-pulse rounded-md bg-surface-2" />
        ))}
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>
  }

  if (versions.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-[3px]"
        role="group"
        aria-label="Video versions"
      >
        {versions.map((version) => {
          const isActive = version.id === activeVersionId
          return (
            <button
              key={version.id}
              type="button"
              onClick={() => onVersionChange(version.id)}
              aria-pressed={isActive}
              className={
                isActive
                  ? 'rounded-md bg-surface px-2.5 py-1 font-mono text-[13px] font-medium text-foreground shadow-sm'
                  : 'rounded-md px-2.5 py-1 font-mono text-[13px] font-medium text-muted-foreground hover:text-foreground'
              }
            >
              v{version.versionNumber}
            </button>
          )
        })}
      </div>
      <EarlierOpenNotes notes={earlierOpen} onSelect={onVersionChange} />
    </div>
  )
}
