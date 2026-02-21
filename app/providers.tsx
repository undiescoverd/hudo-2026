'use client'

import { useEffect } from 'react'
import { hasConsent, initPostHog } from '@/lib/posthog'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (hasConsent()) {
      initPostHog()
    }
  }, [])

  return <>{children}</>
}
