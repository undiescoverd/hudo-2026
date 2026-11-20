export const metadata = { title: 'Offline | Hudo' }

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-2xl font-semibold">You are offline</h1>
      <p className="text-muted-foreground">Check your connection and try again.</p>
    </main>
  )
}
