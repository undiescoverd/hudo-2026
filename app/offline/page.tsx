import type { Metadata } from 'next'

// Static, auth-free page precached by the service worker. Keep it free of
// user data and of JS requirements: it must render from cache while offline.
export const metadata: Metadata = {
  title: 'Offline – Hudo',
  robots: { index: false },
}

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-md text-muted-foreground">
        Hudo needs a connection to load videos and comments. Check your network and try again.
      </p>
      <a href="/" className="rounded-md border px-4 py-2 text-sm font-medium">
        Try again
      </a>
    </main>
  )
}
