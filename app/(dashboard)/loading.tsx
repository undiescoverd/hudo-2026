/**
 * app/(dashboard)/loading.tsx
 *
 * Next.js App Router loading UI for the whole (dashboard) route group.
 * Automatically shown by the framework while a page.tsx server component
 * under this group (dashboard, talent, videos, upload, settings) is
 * fetching data, before any content — including error boundaries — can
 * render. Kept intentionally minimal: a centered spinner in the same
 * container width used by the dashboard pages.
 */

export default function DashboardLoading() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-center py-24" role="status" aria-label="Loading">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    </main>
  )
}
