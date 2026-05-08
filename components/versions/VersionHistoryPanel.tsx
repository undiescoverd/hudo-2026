'use client'

import { useCallback, useEffect, useState } from 'react'

interface Version {
  id: string
  versionNumber: number
  fileSizeBytes: number
  uploadedBy: string
  createdAt: string
}

interface VersionHistoryPanelProps {
  videoId: string
  activeVersionId: string | null
  role: 'owner' | 'admin_agent' | 'agent' | 'talent' | 'guest'
  onActiveChanged?: (versionId: string) => void
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function VersionHistoryPanel({
  videoId,
  activeVersionId,
  role,
  onActiveChanged,
}: VersionHistoryPanelProps) {
  const [versions, setVersions] = useState<Version[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  // Only agents, admins, and owners can set the active version.
  // talent and guest see read-only panel — server-enforced via AGENT_PLUS_ROLES check.
  const canSetActive = role !== 'talent' && role !== 'guest'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/videos/${encodeURIComponent(videoId)}/versions`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to load versions (${res.status})`)
        }
        return res.json() as Promise<{ versions: Version[] }>
      })
      .then(({ versions: data }) => {
        if (!cancelled) {
          setVersions(data)
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
  }, [videoId])

  const setActive = useCallback(
    async (versionId: string) => {
      setPendingId(versionId)
      setError(null)
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active_version_id: versionId }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `Failed to set active version (${res.status})`)
        }
        onActiveChanged?.(versionId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to set active version')
      } finally {
        setPendingId(null)
      }
    },
    [videoId, onActiveChanged]
  )

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400" aria-label="Loading versions">
        Loading versions…
      </div>
    )
  }

  if (error && versions.length === 0) {
    return <div className="p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
  }

  if (versions.length === 0) {
    return <div className="p-4 text-sm text-gray-500 dark:text-gray-400">No versions yet.</div>
  }

  return (
    <div>
      {error && <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <ul className="divide-y divide-gray-100 dark:divide-gray-800">
        {versions.map((v) => {
          const isActive = v.id === activeVersionId
          return (
            <li key={v.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    v{v.versionNumber}
                  </span>
                  {isActive && (
                    <span
                      className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      aria-label="Active version"
                    >
                      Active
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {formatDate(v.createdAt)} · {formatBytes(Number(v.fileSizeBytes))} · uploaded by{' '}
                  {/* TODO: resolve to display name once profiles endpoint exists */}
                  <span className="font-mono">{v.uploadedBy.slice(0, 8)}</span>
                </div>
              </div>

              {canSetActive && !isActive && (
                <button
                  type="button"
                  disabled={pendingId !== null}
                  onClick={() => void setActive(v.id)}
                  className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {pendingId === v.id ? 'Setting…' : 'Set active'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
