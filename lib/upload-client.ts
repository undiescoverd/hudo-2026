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
        : reject(new Error(`Upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
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
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  return body.error ?? fallback
}

/** Runs the full upload and returns the completed videoId. */
export async function performUpload(file: File, options: PerformUploadOptions): Promise<string> {
  const { agencyId, onProgress, putSingle = putFileWithXhr } = options

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
    await putSingle(presign.uploadUrl as string, file, onProgress)
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

  // Multipart upload
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
      const urlRes = await fetch('/api/videos/upload/multipart-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          r2Key: presign.r2Key,
          r2UploadId: presign.r2UploadId,
          partNumber,
          agencyId,
        }),
      })
      if (!urlRes.ok) throw new Error('Failed to get part URL')
      const urlBody = (await urlRes.json()) as { partUrls: { partNumber: number; url: string }[] }
      const partUrl = urlBody.partUrls[0]
      if (!partUrl) throw new Error('Failed to get part URL')
      url = partUrl.url
    }

    const res = await fetch(url, {
      method: 'PUT',
      body: chunk,
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    if (!res.ok) throw new Error(`Part upload failed: ${res.status}`)
    const rawEtag = res.headers.get('ETag') ?? res.headers.get('etag')
    if (!rawEtag) throw new Error(`Part upload succeeded but ETag header was missing`)
    parts.push({ PartNumber: partNumber, ETag: rawEtag.replace(/"/g, '') })
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
