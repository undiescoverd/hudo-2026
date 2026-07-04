'use client'

/**
 * VideoStatusLive — invisible mount that subscribes to live `videos` row
 * changes for one agency and refreshes the current view's data so status
 * flips (e.g. a talent self-upload auto-moving to `pending_review`) show up
 * without a manual reload.
 *
 * Refresh strategy: if an `onChange` callback is provided it is invoked
 * (for client components whose data comes from client-side fetches —
 * router.refresh() only re-runs *server* components, so it would be a no-op
 * there); otherwise falls back to router.refresh() for server-component pages.
 *
 * Renders null. Debounces bursts of Realtime events (trailing, ~500ms) so a
 * flurry of changes causes at most ~1-2 refreshes/sec instead of one per
 * event. The latest `onChange` prop is routed through a ref so the debounced
 * handler passed to the Realtime hook keeps a stable identity — an
 * inline-unstable callback from the caller must not churn the channel
 * subscription.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useRealtimeVideoStatus } from '@/hooks/useRealtimeVideoStatus'

const DEBOUNCE_MS = 500

export function VideoStatusLive({
  agencyId,
  onChange,
}: {
  agencyId: string
  onChange?: () => void
}) {
  const router = useRouter()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Latest-ref pattern: always call the freshest callback without making it
  // a dependency of the debounced handler (which would churn the channel).
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const handleChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      const cb = onChangeRef.current
      if (cb) {
        cb()
      } else {
        router.refresh()
      }
    }, DEBOUNCE_MS)
  }, [router])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useRealtimeVideoStatus({ agencyId, onChange: handleChange })

  return null
}
