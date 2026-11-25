'use client'

/**
 * GuestPlayer — HTML5 video player for guest-link viewers.
 *
 * Fetches a signed playback URL from /api/guest/[token]/playback-url (public
 * endpoint — no Supabase auth required). Refreshes the URL ~3 min before the
 * 15-min expiry using the same pending-swap pattern as useSignedUrl.
 * Renewals send `?renew=1` (see lib/guest-playback) so they don't count as a
 * new view; only the initial load and the error-state Retry do.
 *
 * Security:
 * - The signed URL lives only in React state and the <video src> attribute.
 *   It is never written to window globals, console, or analytics.
 * - `download` attribute is intentionally omitted.
 * - No Supabase client is imported or used.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { guestPlaybackUrlPath } from '@/lib/guest-playback'
import { PlayerLoadError } from '@/components/player/PlayerLoadError'

export type GuestLoadError = 'rate-limited' | 'failed'

export class GuestPlaybackError extends Error {
  constructor(readonly kind: GuestLoadError) {
    super(kind)
  }
}

export function GuestPlayerError({ kind, onRetry }: { kind: GuestLoadError; onRetry: () => void }) {
  const limited = kind === 'rate-limited'
  return (
    <PlayerLoadError
      title={limited ? 'Too many requests' : "This video couldn't be loaded"}
      detail={limited ? 'Give it a minute and try again.' : 'Check your connection and try again.'}
      onRetry={onRetry}
    />
  )
}

/** One playback-url request. A 429 (20/min per link) is told apart from every other failure. */
export async function requestGuestPlaybackUrl(
  token: string,
  isRenewal: boolean,
  signal?: AbortSignal
): Promise<{ url: string; expires_in: number }> {
  const res = await fetch(guestPlaybackUrlPath(token, isRenewal), {
    signal,
    credentials: 'omit', // API ignores cookies; be explicit about intent
  })
  if (!res.ok) throw new GuestPlaybackError(res.status === 429 ? 'rate-limited' : 'failed')
  return (await res.json()) as { url: string; expires_in: number }
}

interface GuestPlayerProps {
  token: string
}

const EXPIRY_SECONDS = 900 // matches the API constant
const REFRESH_BUFFER_SECONDS = 180 // refresh 3 min before expiry

function useGuestSignedUrl(token: string) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<GuestLoadError | null>(null)

  const pendingUrl = useRef<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchUrl = useCallback(
    async (isPending: boolean) => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        // isPending = background renewal → flagged so it isn't counted as a view
        const data = await requestGuestPlaybackUrl(token, isPending, controller.signal)
        const expiresIn = data.expires_in ?? EXPIRY_SECONDS

        if (isPending) {
          pendingUrl.current = data.url
        } else {
          setUrl(data.url)
          setLoading(false)
          setError(null)
        }

        // Schedule refresh before the signed URL expires
        const refreshDelay = Math.max(0, (expiresIn - REFRESH_BUFFER_SECONDS) * 1000)
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => {
          void fetchUrl(true)
        }, refreshDelay)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!isPending) {
          setError(err instanceof GuestPlaybackError ? err.kind : 'failed')
          setLoading(false)
        } else {
          // Retry in 30 s so the URL doesn't expire without a replacement
          refreshTimer.current = setTimeout(() => {
            void fetchUrl(true)
          }, 30_000)
        }
      }
    },
    [token]
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    pendingUrl.current = null
    void fetchUrl(false)

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      if (abortRef.current) abortRef.current.abort()
    }
  }, [fetchUrl])

  return { url, loading, error, setError, pendingUrl, fetchUrl }
}

export function GuestPlayer({ token }: GuestPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { url, loading, error, setError, pendingUrl, fetchUrl } = useGuestSignedUrl(token)

  // Apply pending URL on timeupdate and pause (same pattern as useSignedUrl)
  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    function applyPending() {
      if (!pendingUrl.current || !el) return
      const fresh = pendingUrl.current
      pendingUrl.current = null
      const savedTime = el.currentTime
      const wasPlaying = !el.paused
      el.src = fresh
      el.load()
      const onReady = () => {
        el.currentTime = savedTime
        if (wasPlaying) el.play().catch(() => {})
        el.removeEventListener('loadedmetadata', onReady)
      }
      el.addEventListener('loadedmetadata', onReady)
    }

    el.addEventListener('timeupdate', applyPending)
    el.addEventListener('pause', applyPending)
    return () => {
      el.removeEventListener('timeupdate', applyPending)
      el.removeEventListener('pause', applyPending)
    }
  }, [pendingUrl])

  if (error) return <GuestPlayerError kind={error} onRetry={() => void fetchUrl(false)} />

  return (
    <div className="relative w-full bg-stage">
      {loading && (
        <div className="absolute inset-0 flex aspect-video items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent" />
        </div>
      )}
      {/* No `download` attribute — intentional. Signed URL is in src only. */}
      <video
        ref={videoRef}
        src={url ?? undefined}
        className="aspect-video w-full"
        controls
        playsInline
        controlsList="nodownload"
        onError={() => setError('failed')} // e.g. file missing in storage
      />
    </div>
  )
}
