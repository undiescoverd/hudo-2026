'use client'

import { useEffect } from 'react'

/** Registers /sw.js in production only; renders nothing. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Non-fatal: the app works without the service worker.
    })
  }, [])
  return null
}
