'use client'

/**
 * GuestPlayer — HTML5 video player for guest-link viewers.
 *
 * Fetches a signed playback URL from /api/guest/[token]/playback-url (public
 * endpoint — no Supabase auth required). Refreshes the URL ~3 min before the
 * 15-min expiry using the same pending-swap pattern as useSignedUrl.
 *
 * Security:
 * - The signed URL lives only in React state and the <video src> attribute.
 *   It is never written to window globals, console, or analytics.
 * - `download` attribute is intentionally omitted.
 * - No Supabase client is imported or used.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface GuestPlayerProps {
  token: string
}

const EXPIRY_SECONDS = 900 // matches the API constant
const REFRESH_BUFFER_SECONDS = 180 // refresh 3 min before expiry

function useGuestSignedUrl(token: string) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pendingUrl = useRef<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const fetchUrl = useCallback(
    async (isPending: boolean) => {
      if (abortRef.current) abortRef.current.abort()
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/api/guest/${token}/playback-url`, {
          signal: controller.signal,
          credentials: 'omit', // API ignores cookies; be explicit about intent
        })

        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }

        // API returns { url, expires_in } — snake_case
        const data = (await res.json()) as { url: string; expires_in: number }
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
          setError('Failed to load video')
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

  return { url, loading, error, pendingUrl, fetchUrl }
}

export function GuestPlayer({ token }: GuestPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const { url, loading, error, pendingUrl, fetchUrl } = useGuestSignedUrl(token)

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

  if (error) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-black">
        <p className="text-sm text-gray-400">Failed to load video</p>
        <button
          type="button"
          onClick={() => fetchUrl(false)}
          className="rounded bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="relative w-full bg-black">
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
      />
    </div>
  )
}
