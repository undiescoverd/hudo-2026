'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface SignedUrlState {
  url: string | null
  loading: boolean
  error: string | null
  fetchUrl: (isPending: boolean) => Promise<void>
  applyPendingUrl: (videoEl: HTMLVideoElement) => void
}

export const REFRESH_BUFFER_SECONDS = 180 // refresh 3 min before expiry (at 12-min mark)

export function buildPlaybackUrl(videoId: string, versionId?: string | null): string {
  const base = `/api/videos/${videoId}/playback-url`
  return versionId ? `${base}?versionId=${versionId}` : base
}

export function useSignedUrl(videoId: string, versionId?: string | null): SignedUrlState {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pendingUrl = useRef<string | null>(null)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchUrl = useCallback(
    async (isPending: boolean) => {
      // Abort any in-flight request before starting a new one
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        const endpoint = buildPlaybackUrl(videoId, versionId)
        const res = await fetch(endpoint, { signal: controller.signal })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        const data = (await res.json()) as { url: string; expiresIn: number }

        if (isPending) {
          pendingUrl.current = data.url
        } else {
          setUrl(data.url)
          setLoading(false)
          setError(null)
        }

        // Schedule next refresh at (expiresIn - REFRESH_BUFFER_SECONDS) seconds
        const refreshDelay = (data.expiresIn - REFRESH_BUFFER_SECONDS) * 1000
        if (refreshTimer.current) clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(
          () => {
            void fetchUrl(true)
          },
          Math.max(0, refreshDelay)
        )
      } catch (err) {
        // Ignore aborted requests
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (!isPending) {
          setError('Failed to load video')
          setLoading(false)
        } else {
          // Retry pending refresh in 30 s so the URL doesn't expire without a replacement
          refreshTimer.current = setTimeout(() => {
            void fetchUrl(true)
          }, 30_000)
        }
      }
    },
    [videoId, versionId]
  )

  useEffect(() => {
    setLoading(true)
    setError(null)
    pendingUrl.current = null
    void fetchUrl(false)

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [fetchUrl])

  const pendingListenerRef = useRef<(() => void) | null>(null)

  const applyPendingUrl = useCallback(
    (videoEl: HTMLVideoElement) => {
      if (!pendingUrl.current) return
      const fresh = pendingUrl.current
      pendingUrl.current = null
      const savedTime = videoEl.currentTime
      const wasPlaying = !videoEl.paused

      // Remove any previous loadedmetadata listener before adding a new one
      if (pendingListenerRef.current) {
        videoEl.removeEventListener('loadedmetadata', pendingListenerRef.current)
        pendingListenerRef.current = null
      }

      videoEl.src = fresh
      videoEl.load()
      // currentTime must be set after metadata loads — setting it during load() is ignored
      const onReady = () => {
        videoEl.currentTime = savedTime
        if (wasPlaying) {
          videoEl.play().catch(() => {})
        }
        videoEl.removeEventListener('loadedmetadata', onReady)
        pendingListenerRef.current = null
      }
      pendingListenerRef.current = onReady
      videoEl.addEventListener('loadedmetadata', onReady)
      setUrl(fresh)
    },
    [] // pendingUrl is a ref; setUrl is stable from useState
  )

  return { url, loading, error, fetchUrl, applyPendingUrl }
}
