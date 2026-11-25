'use client'

import { useEffect, useState } from 'react'
import { DEFAULT_EXPIRY_PRESET, expiresAtForPreset } from '@/lib/guest-link-options'

export interface GuestLink {
  id: string
  label: string | null
  version_number: number | null
  expires_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_at: string
}

interface GuestLinkListProps {
  videoId: string
  refreshTrigger?: number
}

/** True when the link is pinned to a version older than the video's current one. */
export function isOlderVersion(link: GuestLink, currentVersion: number | null): boolean {
  return (
    link.version_number !== null && currentVersion !== null && link.version_number < currentVersion
  )
}

/** "Share vN instead": a NEW link for the current version; the old link is left alone. */
export async function shareCurrentVersion(
  videoId: string,
  label: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const res = await fetchImpl(`/api/videos/${videoId}/guest-links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      expires_at: expiresAtForPreset(DEFAULT_EXPIRY_PRESET),
      ...(label ? { label } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Failed to create link (${res.status})`)
  return ((await res.json()) as { url: string }).url
}

export function GuestLinkRow({
  link,
  currentVersion,
  revoking,
  sharing,
  onRevoke,
  onShareCurrent,
}: {
  link: GuestLink
  currentVersion: number | null
  revoking: boolean
  sharing: boolean
  onRevoke: () => void
  onShareCurrent: () => void
}) {
  const older = isOlderVersion(link, currentVersion)
  return (
    <div className="flex items-center justify-between p-3 border border-gray-200 rounded-md bg-gray-50">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 text-sm text-gray-900">
          {link.label && <span className="font-medium truncate">{link.label}</span>}
          {link.version_number !== null && (
            <span className="text-xs text-gray-600">v{link.version_number}</span>
          )}
        </div>
        {older && (
          <p className="text-xs text-amber-700">
            Shows an older version.{' '}
            <button
              type="button"
              onClick={onShareCurrent}
              disabled={sharing}
              className="font-medium underline disabled:opacity-50"
            >
              {sharing ? 'Creating…' : `Share v${currentVersion} instead`}
            </button>
          </p>
        )}
        <div className="flex gap-4 text-xs text-gray-600">
          <div>
            <span className="font-medium">Created:</span> {formatDate(link.created_at)}
          </div>
          <div>
            <span className="font-medium">Expires:</span>{' '}
            {link.expires_at ? formatDate(link.expires_at) : 'Never'}
          </div>
          <div>
            <span className="font-medium">Views:</span> {link.view_count}
          </div>
          <div>
            <span className="font-medium">Last viewed:</span>{' '}
            {link.last_viewed_at ? formatRelativeTime(link.last_viewed_at) : 'Never'}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onRevoke}
        disabled={revoking}
        className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:bg-gray-200 disabled:text-gray-500 transition-colors"
      >
        {revoking ? 'Revoking…' : 'Revoke'}
      </button>
    </div>
  )
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatRelativeTime(dateString: string): string {
  const now = new Date()
  const date = new Date(dateString)
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateString)
}

export function GuestLinkList({ videoId, refreshTrigger = 0 }: GuestLinkListProps) {
  const [links, setLinks] = useState<GuestLink[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<number | null>(null)
  const [sharing, setSharing] = useState<string | null>(null)
  const [newUrl, setNewUrl] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/videos/${videoId}/guest-links`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load links (${res.status})`)
        return res.json() as Promise<{ links: GuestLink[]; current_version_number: number | null }>
      })
      .then(({ links: fetched, current_version_number }) => {
        if (!cancelled) {
          setLinks(fetched)
          setCurrentVersion(current_version_number)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load links')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [videoId, refreshTrigger, reload])

  const handleRevoke = async (linkId: string) => {
    if (!window.confirm('Revoke this guest link? It will no longer be accessible.')) {
      return
    }

    setRevoking(linkId)
    try {
      const res = await fetch(`/api/guest-links/${linkId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`Failed to revoke link (${res.status})`)
      setLinks((prev) => prev.filter((l) => l.id !== linkId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke link')
    } finally {
      setRevoking(null)
    }
  }

  const handleShareCurrent = async (link: GuestLink) => {
    setSharing(link.id)
    setNewUrl(null)
    try {
      setNewUrl(await shareCurrentVersion(videoId, link.label))
      setReload((n) => n + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setSharing(null)
    }
  }

  if (loading) {
    return <div className="text-sm text-gray-500">Loading links...</div>
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  if (links.length === 0) {
    return <p className="text-sm text-gray-500">No active guest links.</p>
  }

  return (
    <div className="space-y-2">
      {newUrl && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800 space-y-1">
          <p>
            <strong>New link created.</strong> It will not be shown again. Copy it now.
          </p>
          <input
            type="text"
            readOnly
            value={newUrl}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full px-2 py-1 border border-gray-300 rounded text-xs text-gray-700 bg-white"
          />
        </div>
      )}
      {links.map((link) => (
        <GuestLinkRow
          key={link.id}
          link={link}
          currentVersion={currentVersion}
          revoking={revoking === link.id}
          sharing={sharing === link.id}
          onRevoke={() => handleRevoke(link.id)}
          onShareCurrent={() => handleShareCurrent(link)}
        />
      ))}
    </div>
  )
}
