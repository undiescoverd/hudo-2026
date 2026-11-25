/**
 * Guest playback page — /guest/[token]
 *
 * Server component. Calls resolveGuestLink directly (no HTTP round-trip, no
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
import { resolveGuestLink } from '@/lib/guest/get-guest-metadata'

export default async function GuestPage({ params }: { params: { token: string } }) {
  const { token } = params

  const result = await resolveGuestLink(token)

  // The reason is an allowlisted word, never the token or any link detail.
  if (!result.ok) {
    redirect(`/guest/invalid?reason=${result.reason}`)
  }
  const data = result.data

  // A valid token but no video isn't useful — treat as invalid
  if (!data.video) {
    redirect('/guest/invalid')
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="flex h-14 items-center border-b border-line bg-surface px-5">
        <span className="text-xl font-semibold tracking-tight">hudo</span>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <h1 className="mb-4 text-[26px] font-semibold leading-tight tracking-tight">
          {data.video.title}
        </h1>

        {/* Guests see the video only: no comments (flow decision). */}
        {data.version ? (
          <GuestReview token={token} />
        ) : (
          <p className="text-sm text-gray-600">No video version is available yet.</p>
        )}
      </main>
    </div>
  )
}
