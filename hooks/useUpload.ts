'use client'

import { ALLOWED_EXTENSIONS, MULTIPART_PART_SIZE_BYTES } from '@/lib/upload-validation'

// --- Types ---

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'success'; videoId: string }
  | { status: 'error'; message: string; isQuotaExceeded: boolean }

// --- Pure helpers (exported for testing) ---

export function getContentType(file: File): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mov') return 'video/quicktime'
  return null
}

export function isQuotaError(status: number): boolean {
  return status === 402
}

// --- Hook ---

import { useState, useRef } from 'react'

interface PresignSingleResponse {
  videoId: string
  r2Key: string
  multipart: false
  uploadUrl: string
}

interface PresignMultipartResponse {
  videoId: string
  r2Key: string
  multipart: true
  r2UploadId: string
  partCount: number
  partUrls: { partNumber: number; url: string }[]
}

type PresignResponse = PresignSingleResponse | PresignMultipartResponse

async function fetchPresign(
  file: File,
  agencyId: string,
  contentType: string
): Promise<PresignResponse> {
  const res = await fetch('/api/videos/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agencyId,
      fileName: file.name,
      contentType,
      fileSizeBytes: file.size,
    }),
  })

  const data = (await res.json()) as Record<string, unknown>

  if (!res.ok) {
    const message = typeof data.error === 'string' ? data.error : `Upload failed (${res.status})`
    throw Object.assign(new Error(message), { status: res.status })
  }

  return data as unknown as PresignResponse
}

async function fetchMultipartUrls(
  r2Key: string,
  r2UploadId: string,
  partNumbers: number[]
): Promise<{ partNumber: number; url: string }[]> {
  const res = await fetch('/api/videos/upload/multipart-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ r2Key, r2UploadId, partNumbers }),
  })

  const data = (await res.json()) as Record<string, unknown>

  if (!res.ok) {
    const message =
      typeof data.error === 'string' ? data.error : `Failed to get part URLs (${res.status})`
    throw Object.assign(new Error(message), { status: res.status })
  }

  return (data.partUrls as { partNumber: number; url: string }[]) ?? []
}

async function fetchComplete(payload: {
  videoId: string
  agencyId: string
  r2Key: string
  fileSizeBytes: number
  multipart: boolean
  r2UploadId?: string
  parts?: { PartNumber: number; ETag: string }[]
}): Promise<string> {
  const res = await fetch('/api/videos/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  const data = (await res.json()) as Record<string, unknown>

  if (!res.ok) {
    const message =
      typeof data.error === 'string' ? data.error : `Completion failed (${res.status})`
    throw Object.assign(new Error(message), { status: res.status })
  }

  return typeof data.videoId === 'string' ? data.videoId : (payload.videoId as string)
}

function xhrPut(url: string, blob: Blob, onProgress?: (loaded: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded)
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader('ETag') ?? xhr.getResponseHeader('etag') ?? ''
        resolve(etag)
      } else {
        reject(new Error(`PUT failed with status ${xhr.status}`))
      }
    }

    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(blob)
  })
}

export function useUpload(): {
  state: UploadState
  upload: (file: File, agencyId: string) => Promise<void>
  reset: () => void
} {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const abortRef = useRef(false)

  function reset() {
    abortRef.current = false
    setState({ status: 'idle' })
  }

  async function upload(file: File, agencyId: string): Promise<void> {
    abortRef.current = false
    setState({ status: 'uploading', progress: 0 })

    try {
      const contentType = getContentType(file)
      if (!contentType) {
        setState({
          status: 'error',
          message: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
          isQuotaExceeded: false,
        })
        return
      }

      // 1. Presign
      let presign: PresignResponse
      try {
        presign = await fetchPresign(file, agencyId, contentType)
      } catch (err) {
        const status = (err as { status?: number }).status
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to start upload',
          isQuotaExceeded: isQuotaError(status ?? 0),
        })
        return
      }

      const { videoId, r2Key } = presign

      if (!presign.multipart) {
        // 2a. Single-part upload via XHR for progress events
        try {
          await xhrPut(presign.uploadUrl, file, (loaded) => {
            setState({ status: 'uploading', progress: Math.round((loaded / file.size) * 100) })
          })
        } catch (err) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Upload failed',
            isQuotaExceeded: false,
          })
          return
        }

        // 3a. Complete single-part
        try {
          const finalVideoId = await fetchComplete({
            videoId,
            agencyId,
            r2Key,
            fileSizeBytes: file.size,
            multipart: false,
          })
          setState({ status: 'success', videoId: finalVideoId })
        } catch (err) {
          const status = (err as { status?: number }).status
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to complete upload',
            isQuotaExceeded: isQuotaError(status ?? 0),
          })
        }
        return
      }

      // 2b. Multipart upload
      const { r2UploadId, partCount } = presign
      let partUrls = [...presign.partUrls]
      const parts: { PartNumber: number; ETag: string }[] = []
      let uploadedBytes = 0

      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        if (abortRef.current) {
          setState({ status: 'error', message: 'Upload cancelled', isQuotaExceeded: false })
          return
        }

        // Fetch more URLs in batches of 10 when exhausted
        if (!partUrls.find((p) => p.partNumber === partNumber)) {
          const needed = Array.from(
            { length: Math.min(10, partCount - partNumber + 1) },
            (_, i) => partNumber + i
          )
          try {
            const newUrls = await fetchMultipartUrls(r2Key, r2UploadId, needed)
            partUrls = [...partUrls, ...newUrls]
          } catch (err) {
            setState({
              status: 'error',
              message: err instanceof Error ? err.message : 'Failed to get upload URLs',
              isQuotaExceeded: false,
            })
            return
          }
        }

        const partUrl = partUrls.find((p) => p.partNumber === partNumber)
        if (!partUrl) {
          setState({ status: 'error', message: 'Missing part URL', isQuotaExceeded: false })
          return
        }

        const start = (partNumber - 1) * MULTIPART_PART_SIZE_BYTES
        const end = Math.min(start + MULTIPART_PART_SIZE_BYTES, file.size)
        const chunk = file.slice(start, end)

        let etag: string
        try {
          etag = await xhrPut(partUrl.url, chunk, (loaded) => {
            const totalLoaded = uploadedBytes + loaded
            setState({
              status: 'uploading',
              progress: Math.round((totalLoaded / file.size) * 100),
            })
          })
        } catch (err) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : 'Part upload failed',
            isQuotaExceeded: false,
          })
          return
        }

        uploadedBytes += chunk.size
        parts.push({ PartNumber: partNumber, ETag: etag })
        setState({ status: 'uploading', progress: Math.round((uploadedBytes / file.size) * 100) })
      }

      // 3b. Complete multipart
      try {
        const finalVideoId = await fetchComplete({
          videoId,
          agencyId,
          r2Key,
          fileSizeBytes: file.size,
          multipart: true,
          r2UploadId,
          parts,
        })
        setState({ status: 'success', videoId: finalVideoId })
      } catch (err) {
        const status = (err as { status?: number }).status
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to complete upload',
          isQuotaExceeded: isQuotaError(status ?? 0),
        })
      }
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unexpected error',
        isQuotaExceeded: false,
      })
    }
  }

  return { state, upload, reset }
}
