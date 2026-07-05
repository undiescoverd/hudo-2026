/**
 * Guest playback page — /guest/[token]
 *
 * Server component. Calls getGuestMetadata directly (no HTTP round-trip, no
 * host-header risk, no NEXT_PUBLIC_BASE_URL dependency). An invalid/expired/
 * revoked token → redirect to /guest/invalid. All data flows through the lib
 * helper and then API routes for dynamic resources (playback URL).
 *
 * Rate-limiting note: rate limiting for the metadata lookup lives at the
 * /api/guest/[token] API layer. The page calls the helper directly (one lookup
 * per page render), which is naturally throttled by Next.js server rendering.
 * The playback-url path is separately rate-limited in its own API route.
 */
import { redirect } from 'next/navigation'
import { GuestReview } from '@/components/guest/GuestReview'
import { getGuestMetadata } from '@/lib/guest/get-guest-metadata'

export default async function GuestPage({ params }: { params: { token: string } }) {
  const { token } = params

  const data = await getGuestMetadata(token)

  if (!data) {
    redirect('/guest/invalid')
  }

  // A valid token but no video isn't useful — treat as invalid
  if (!data.video) {
    redirect('/guest/invalid')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Minimal header */}
      <header className="border-b border-gray-800 px-4 py-3">
        <p className="text-sm text-gray-400">Hudo — Video Review</p>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Video title */}
        <h1 className="mb-4 text-xl font-semibold text-gray-100">{data.video.title}</h1>

        {data.version ? (
          <GuestReview token={token} comments={data.comments} />
        ) : (
          <p className="text-sm text-gray-500">No video version is available yet.</p>
        )}
      </main>
    </div>
  )
}
