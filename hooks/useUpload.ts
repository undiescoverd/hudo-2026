'use client'

import { useCallback, useRef, useState } from 'react'
import { MULTIPART_PART_SIZE_BYTES } from '@/lib/upload-validation'

interface UseUploadOptions {
  file: File
  agencyId: string
  onProgress: (percent: number) => void
}

interface UseUploadReturn {
  upload: () => Promise<string>
  uploading: boolean
  error: string | null
  reset: () => void
}

// Upload a single part via PUT, return ETag from response headers
async function uploadPart(url: string, data: Blob): Promise<string> {
  const res = await fetch(url, {
    method: 'PUT',
    body: data,
    headers: { 'Content-Type': 'application/octet-stream' },
  })
  if (!res.ok) throw new Error(`Part upload failed: ${res.status}`)
  const etag = res.headers.get('ETag') ?? res.headers.get('etag') ?? ''
  return etag.replace(/"/g, '')
}

// Upload standard (single PUT) with XHR for progress
function uploadStandard(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

export function useUpload({ file, agencyId, onProgress }: UseUploadOptions): UseUploadReturn {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)

  const reset = useCallback(() => {
    setError(null)
    setUploading(false)
    abortRef.current = false
  }, [])

  const upload = useCallback(async (): Promise<string> => {
    setUploading(true)
    setError(null)
    abortRef.current = false

    try {
      // Step 1: Presign
      const presignRes = await fetch('/api/videos/upload/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencyId,
          fileName: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
        }),
      })

      if (presignRes.status === 402) {
        throw new Error('Storage quota exceeded')
      }
      if (!presignRes.ok) {
        const body = (await presignRes.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Presign failed: ${presignRes.status}`)
      }

      const presign = await presignRes.json()

      if (!presign.multipart) {
        // Standard single upload
        await uploadStandard(presign.uploadUrl as string, file, file.type, onProgress)
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
          const body = (await completeRes.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Failed to complete upload')
        }
        const result = (await completeRes.json()) as { videoId: string }
        return result.videoId
      } else {
        // Multipart upload
        const partUrls = presign.partUrls as { partNumber: number; url: string }[]
        const partCount = presign.partCount as number
        const parts: { PartNumber: number; ETag: string }[] = []
        let completedParts = 0

        for (let i = 0; i < partCount; i++) {
          const partNumber = i + 1
          const start = i * MULTIPART_PART_SIZE_BYTES
          const end = Math.min(start + MULTIPART_PART_SIZE_BYTES, file.size)
          const chunk = file.slice(start, end)

          // Get URL — may need to fetch additional if beyond initial batch
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
            const urlData = (await urlRes.json()) as { url: string }
            url = urlData.url
          }

          const etag = await uploadPart(url, chunk)
          parts.push({ PartNumber: partNumber, ETag: etag })
          completedParts++
          onProgress(Math.round((completedParts / partCount) * 100))
        }

        const completeRes = await fetch('/api/videos/upload/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: presign.videoId,
            agencyId,
            r2Key: presign.r2Key,
            fileSizeBytes: file.size,
            r2UploadId: presign.r2UploadId,
            parts,
          }),
        })
        if (!completeRes.ok) {
          const body = (await completeRes.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? 'Failed to complete multipart upload')
        }
        const result = (await completeRes.json()) as { videoId: string }
        return result.videoId
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setError(msg)
      throw err
    } finally {
      setUploading(false)
    }
  }, [file, agencyId, onProgress])

  return { upload, uploading, error, reset }
}
