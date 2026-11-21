/**
 * Shared contract between GuestPlayer and GET /api/guest/:token/playback-url
 * for telling a first load apart from a signed-URL renewal.
 *
 * The player re-fetches the 15-min signed URL before it expires; those
 * renewals carry `?renew=1` and the route skips the view-count RPC for them,
 * so one uninterrupted watch counts as one view. A page load (including a
 * reload) or the error-state Retry sends no flag and counts.
 *
 * Spoofing the flag can only suppress the caller's own view — it never
 * inflates counts or unlocks anything (token validation is unchanged).
 *
 * Pure module: imported by a client component, so no server-only imports.
 */
export const GUEST_PLAYBACK_RENEW_PARAM = 'renew'

export function guestPlaybackUrlPath(token: string, isRenewal: boolean): string {
  const base = `/api/guest/${token}/playback-url`
  return isRenewal ? `${base}?${GUEST_PLAYBACK_RENEW_PARAM}=1` : base
}

export function isGuestPlaybackRenewal(searchParams: URLSearchParams): boolean {
  return searchParams.get(GUEST_PLAYBACK_RENEW_PARAM) === '1'
}
