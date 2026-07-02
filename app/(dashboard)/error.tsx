'use client'

/**
 * app/(dashboard)/error.tsx
 *
 * Next.js App Router error boundary for the (dashboard) route group.
 * Must be a Client Component (App Router requirement) — catches
 * unhandled exceptions thrown while rendering page.tsx server components
 * (or their children) under this group, and offers a `reset()` retry.
 *
 * This is distinct from the expected/handled data-fetch error path, which
 * pages catch themselves and render via <DashboardError /> — this
 * boundary is only for genuinely unexpected render-time errors.
 */

import { useEffect } from 'react'

type Props = {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardRouteError({ error, reset }: Props) {
  useEffect(() => {
    console.error('[dashboard-route-error]', error)
  }, [error])

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <p className="text-sm text-destructive" role="alert">
          Something went wrong. Please try again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/20"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
