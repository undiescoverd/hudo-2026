'use client'

import { useEffect, useState } from 'react'
import { grantConsent, denyConsent } from '@/lib/posthog'

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem('hudo_cookie_consent')
    if (!consent) {
      setVisible(true)
    }
  }, [])

  if (!visible) return null

  function handleAccept() {
    grantConsent()
    setVisible(false)
  }

  function handleDecline() {
    denyConsent()
    setVisible(false)
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background p-4">
      <div className="mx-auto flex max-w-screen-xl items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          We use cookies to improve your experience. By accepting, you allow us to collect anonymous
          usage data.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleDecline}
            className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
