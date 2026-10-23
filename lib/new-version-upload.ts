/**
 * Parse the `videoId` search param of /upload. Only a single non-empty string
 * enables version mode; arrays (repeated params) and blanks are ignored.
 */
export function parseTargetVideoId(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}
