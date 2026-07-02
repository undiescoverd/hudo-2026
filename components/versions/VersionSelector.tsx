'use client'

import { useEffect, useState } from 'react'

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

  const versions = isControlled ? (controlledVersions ?? []) : fetchedVersions
  const isLoading = isControlled ? controlledVersions === null : loading

  if (isLoading) {
    return (
      <div className="flex items-center gap-2" aria-label="Loading versions">
        {[1, 2].map((i) => (
          <div key={i} className="h-8 w-10 animate-pulse rounded-md bg-gray-200" />
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
    <div className="flex items-center gap-1" role="group" aria-label="Video versions">
      {versions.map((version) => {
        const isActive = version.id === activeVersionId
        return (
          <button
            key={version.id}
            type="button"
            onClick={() => onVersionChange(version.id)}
            aria-pressed={isActive}
            aria-label={`Version ${version.versionNumber}`}
            className={
              isActive
                ? 'rounded-md px-3 py-1.5 text-sm font-medium bg-gray-900 text-white'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }
          >
            v{version.versionNumber}
          </button>
        )
      })}
    </div>
  )
}
