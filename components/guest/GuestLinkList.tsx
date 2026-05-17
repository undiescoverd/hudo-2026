'use client'

import { useEffect, useState } from 'react'

interface GuestLink {
  id: string
  expires_at: string | null
  view_count: number
  last_viewed_at: string | null
  created_at: string
}

interface GuestLinkListProps {
  videoId: string
  refreshTrigger?: number
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

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/videos/${videoId}/guest-links`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load links (${res.status})`)
        return res.json() as Promise<{ links: GuestLink[] }>
      })
      .then(({ links: fetched }) => {
        if (!cancelled) {
          setLinks(fetched)
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
  }, [videoId, refreshTrigger])

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
      {links.map((link) => (
        <div
          key={link.id}
          className="flex items-center justify-between p-3 border border-gray-200 rounded-md bg-gray-50"
        >
          <div className="flex-1 min-w-0">
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
            onClick={() => handleRevoke(link.id)}
            disabled={revoking === link.id}
            className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded hover:bg-red-100 disabled:bg-gray-200 disabled:text-gray-500 transition-colors"
          >
            {revoking === link.id ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      ))}
    </div>
  )
}
