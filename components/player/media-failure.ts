/**
 * A media error belongs to the signed URL that produced it. Tracking the failed
 * URL (rather than a boolean) means the error clears by itself when a NEW url
 * lands, and a late error event from the old url can never re-trigger it.
 * Retry deliberately does not clear it: the <video> stays mounted on the old
 * url until the fresh one arrives.
 */
export function isMediaFailed(failedUrl: string | null, currentUrl: string | null): boolean {
  return failedUrl !== null && failedUrl === currentUrl
}
