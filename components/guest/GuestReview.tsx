'use client'

/**
 * GuestReview — the guest-facing video stage.
 *
 * Product decision (flow decision, design v3): guests see the video only —
 * no comments. Guests get no Supabase access and no authed player context,
 * so this renders the token-scoped GuestPlayer on its own.
 */

import { GuestPlayer } from './GuestPlayer'

interface GuestReviewProps {
  token: string
}

export function GuestReview({ token }: GuestReviewProps) {
  return (
    <div className="mx-auto w-full max-w-5xl overflow-hidden rounded-xl bg-stage">
      <GuestPlayer token={token} />
    </div>
  )
}
