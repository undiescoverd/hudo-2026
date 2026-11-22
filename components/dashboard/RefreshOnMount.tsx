'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-reads the server component tree once when mounted. Next 14's client
 * Router Cache can serve a dynamic page for ~30s on Link/back navigation, so
 * data that changed elsewhere (e.g. unread counts cleared on the video page)
 * would otherwise look stale.
 */
export function RefreshOnMount() {
  const router = useRouter()
  useEffect(() => {
    router.refresh()
  }, [router])
  return null
}
