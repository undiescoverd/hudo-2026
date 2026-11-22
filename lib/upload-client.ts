/**
 * Browser-side upload orchestration (presign -> PUT / multipart -> complete).
 *
 * Extracted from app/(dashboard)/upload/page.tsx so it can be unit-tested.
 * Uses the global `fetch`; the single-PUT transport (XHR, for progress events)
 * is injectable via `options.putSingle`.
 */

import { MULTIPART_PART_SIZE_BYTES } from '@/lib/upload-validation'

/** The exact prefix of the server's quota message (presign + complete routes). */
export const QUOTA_MESSAGE_PREFIX = 'Storage quota exceeded'

/** True only for the real storage-quota message — not past-due, rate-limit, etc. */
export function isQuotaMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.startsWith(QUOTA_MESSAGE_PREFIX)
}

/** Transport failure carrying the HTTP status (undefined = no response, i.e. network error). */
export class UploadHttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'UploadHttpError'
  }
}

/**
 * Retry only what can plausibly succeed next time: network failures, 408, 429, 5xx.
 * Any other 4xx (e.g. 403 from an expired/invalid signature) is final, since the same
 * presigned URL would be rejected again. A plain Error (e.g. missing ETag, which is a
 * CORS misconfiguration) or a stray TypeError (a programming error) is final too.
 * Network failures are tagged explicitly: see `networkFetch` and the XHR transport.
 */
export function isRetryableUploadError(err: unknown): boolean {
  if (!(err instanceof UploadHttpError)) return false
  const s = err.status
  return s === undefined || s === 408 || s === 429 || s >= 500
}

/** fetch() that reports a network-layer failure (TypeError) as a retryable UploadHttpError. */
async function networkFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw new UploadHttpError('Network error during upload', undefined, { cause: err })
  }
}

export interface RetryOptions {
  /** Total attempts including the first. Default 3. */
  maxAttempts?: number
  /** Base backoff in ms; doubles each attempt. Default 500. */
  baseDelayMs?: number
  /** Injectable so tests don't sleep. */
  sleep?: (ms: number) => Promise<void>
  /** Injectable jitter source in [0, 1). */
  random?: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Run `fn`, retrying retryable failures with exponential backoff + jitter (50-100% of the delay). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 500, sleep = defaultSleep, random = Math.random } = opts
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRetryableUploadError(err)) throw err
      if (attempt >= maxAttempts) {
        throw new UploadHttpError(
          `${(err as Error).message} (gave up after ${maxAttempts} attempts)`,
          (err as UploadHttpError).status,
          { cause: err }
        )
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1) * (0.5 + random() / 2))
    }
  }
}

/** Add a `beforeunload` warning; returns the remover. */
export function attachBeforeUnloadGuard(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>
): () => void {
  const handler = (e: BeforeUnloadEvent) => {
    e.preventDefault()
    e.returnValue = ''
  }
  target.addEventListener('beforeunload', handler)
  return () => target.removeEventListener('beforeunload', handler)
}

const RATE_LIMIT_FALLBACK = 'Too many upload requests. Please try again later.'

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

/** Human wait string from a number of seconds ("42 seconds", "5 minutes", "1 hour 5 minutes"). */
export function formatWait(seconds: number): string {
  if (seconds < 60) return plural(Math.max(1, Math.ceil(seconds)), 'second')
  const totalMinutes = Math.ceil(seconds / 60)
  if (totalMinutes < 60) return plural(totalMinutes, 'minute')
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0
    ? plural(hours, 'hour')
    : `${plural(hours, 'hour')} ${plural(minutes, 'minute')}`
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) to seconds, or null if unusable. */
export function parseRetryAfterSeconds(
  header: string | null,
  now: number = Date.now()
): number | null {
  if (!header) return null
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    const s = Number(trimmed)
    return s > 0 ? s : null
  }
  const dateMs = Date.parse(trimmed)
  if (Number.isNaN(dateMs)) return null
  const s = Math.ceil((dateMs - now) / 1000)
  return s > 0 ? s : null
}

/** Message for a non-ok presign response. Server messages pass through verbatim. */
export function presignErrorMessage(
  status: number,
  body: { error?: string },
  retryAfter: string | null
): string {
  if (status === 429) {
    const seconds = parseRetryAfterSeconds(retryAfter)
    return seconds === null
      ? RATE_LIMIT_FALLBACK
      : `Too many upload requests. Try again in ${formatWait(seconds)}.`
  }
  return body.error ?? `Presign failed: ${status}`
}

export interface PresignRequestInput {
  agencyId: string
  fileName: string
  contentType: string
  fileSizeBytes: number
  /** Reuse an existing draft video (retry). Omit to create a new one. */
  videoId?: string
  /** Agent-class uploaders only. Never set for the talent role. */
  talentId?: string
}

/** Build the presign request body. Optional keys are omitted entirely when unset. */
export function buildPresignBody(input: PresignRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    agencyId: input.agencyId,
    fileName: input.fileName,
    contentType: input.contentType,
    fileSizeBytes: input.fileSizeBytes,
  }
  if (input.videoId) body.videoId = input.videoId
  if (input.talentId) body.talentId = input.talentId
  return body
}

export interface PresignResponse {
  videoId: string
  r2Key: string
  multipart: boolean
  uploadUrl?: string
  r2UploadId?: string
  partCount?: number
  partUrls?: { partNumber: number; url: string }[]
}

export async function requestPresign(input: PresignRequestInput): Promise<PresignResponse> {
  const res = await fetch('/api/videos/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPresignBody(input)),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(presignErrorMessage(res.status, body, res.headers.get('Retry-After')))
  }
  return (await res.json()) as PresignResponse
}

/** Default single-PUT transport: XHR so we get upload progress events. */
export function putFileWithXhr(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new UploadHttpError(`Upload failed: ${xhr.status}`, xhr.status))
    }
    xhr.onerror = () => reject(new UploadHttpError('Network error during upload'))
    xhr.send(file)
  })
}

export interface PerformUploadOptions {
  agencyId: string
  onProgress: (percent: number) => void
  /** Existing draft to reuse (retry). Pass the id reported via `onVideoId` on a previous attempt. */
  videoId?: string
  /** Agent-class uploaders only. Never pass for the talent role. */
  talentId?: string
  /** Called as soon as presign succeeds — before the PUT — so a retry can reuse the draft. */
  onVideoId?: (videoId: string) => void
  /** Override the single-PUT transport (tests). */
  putSingle?: typeof putFileWithXhr
  /** Retry policy for each PUT (tests inject a no-op sleep). */
  retry?: RetryOptions
  /** Override the multipart abort call (tests). */
  abortMultipart?: typeof abortMultipartUpload
}

/** Best-effort abort of an unfinished multipart upload; never throws (the original error matters more). */
export async function abortMultipartUpload(r2Key: string, r2UploadId: string): Promise<void> {
  try {
    const res = await fetch('/api/videos/upload/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r2Key, r2UploadId }),
      // A hung abort must not delay the real error reaching the user.
      signal: AbortSignal.timeout(5000),
    })
    // Never log the key or upload id.
    if (!res.ok) console.warn(`[upload] multipart abort failed: ${res.status}`)
  } catch {
    // Best effort. Anything left behind is removed by the bucket's R2 lifecycle rule
    // (AbortIncompleteMultipartUpload after 1 day, see docs/r2-setup.md).
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? fallback
}

/** Runs the full upload and returns the completed videoId. */
export async function performUpload(file: File, options: PerformUploadOptions): Promise<string> {
  const {
    agencyId,
    onProgress,
    putSingle = putFileWithXhr,
    retry,
    abortMultipart = abortMultipartUpload,
  } = options

  const presign = await requestPresign({
    agencyId,
    fileName: file.name,
    contentType: file.type,
    fileSizeBytes: file.size,
    videoId: options.videoId,
    talentId: options.talentId,
  })
  options.onVideoId?.(presign.videoId)

  if (!presign.multipart) {
    await withRetry(async () => {
      onProgress(0) // a retry restarts the transfer, so don't leave the bar at its old value
      await putSingle(presign.uploadUrl as string, file, onProgress)
    }, retry)
    onProgress(100)

    const completeRes = await fetch('/api/videos/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: presign.videoId,
        agencyId,
        r2Key: presign.r2Key,
        fileSizeBytes: file.size,
      }),
    })
    if (!completeRes.ok) {
      throw new Error(await readError(completeRes, 'Failed to complete upload'))
    }
    return ((await completeRes.json()) as { videoId: string }).videoId
  }

  // Multipart upload. Any failure aborts the R2 upload so parts don't linger; a Retry
  // re-presigns (reusing the draft videoId) and starts a fresh multipart upload.
  try {
    return await uploadMultipart(file, presign, options)
  } catch (err) {
    await abortMultipart(presign.r2Key, presign.r2UploadId as string)
    throw err
  }
}

async function uploadMultipart(
  file: File,
  presign: PresignResponse,
  options: PerformUploadOptions
): Promise<string> {
  const { agencyId, onProgress, retry } = options
  const partUrls = presign.partUrls ?? []
  const partCount = presign.partCount as number
  const parts: { PartNumber: number; ETag: string }[] = []

  for (let i = 0; i < partCount; i++) {
    const partNumber = i + 1
    const start = i * MULTIPART_PART_SIZE_BYTES
    const end = Math.min(start + MULTIPART_PART_SIZE_BYTES, file.size)
    const chunk = file.slice(start, end)

    let url: string
    const existing = partUrls.find((p) => p.partNumber === partNumber)
    if (existing) {
      url = existing.url
    } else {
      url = await withRetry(async () => {
        const urlRes = await networkFetch('/api/videos/upload/multipart-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            r2Key: presign.r2Key,
            r2UploadId: presign.r2UploadId,
            partNumber,
            agencyId,
          }),
        })
        if (!urlRes.ok) {
          const message = await readError(urlRes, `Failed to get part URL: ${urlRes.status}`)
          // 429 is a rate limit: retrying immediately would only burn more of it.
          if (urlRes.status === 429) throw new Error(message)
          throw new UploadHttpError(message, urlRes.status)
        }
        const urlBody = (await urlRes.json()) as { partUrls?: { url: string }[] }
        const partUrl = urlBody.partUrls?.[0]
        if (!partUrl) throw new Error('Failed to get part URL: empty response')
        return partUrl.url
      }, retry)
    }

    // Same presigned URL on each attempt: no new presign, so no extra quota/rate-limit hit.
    const etag = await withRetry(async () => {
      const res = await networkFetch(url, {
        method: 'PUT',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
      if (!res.ok)
        throw new UploadHttpError(`Part ${partNumber} upload failed: ${res.status}`, res.status)
      const rawEtag = res.headers.get('ETag') ?? res.headers.get('etag')
      if (!rawEtag) throw new Error(`Part upload succeeded but ETag header was missing`)
      return rawEtag.replace(/"/g, '')
    }, retry)
    parts.push({ PartNumber: partNumber, ETag: etag })
    onProgress(Math.round(((i + 1) / partCount) * 100))
  }

  const completeRes = await fetch('/api/videos/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      videoId: presign.videoId,
      agencyId,
      r2Key: presign.r2Key,
      fileSizeBytes: file.size,
      multipart: true,
      r2UploadId: presign.r2UploadId,
      parts,
    }),
  })
  if (!completeRes.ok) {
    throw new Error(await readError(completeRes, 'Failed to complete multipart upload'))
  }
  return ((await completeRes.json()) as { videoId: string }).videoId
}
