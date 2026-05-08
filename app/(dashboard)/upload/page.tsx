'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadZone } from '@/components/upload/UploadZone'
import { UploadProgress } from '@/components/upload/UploadProgress'
import { MetadataForm } from '@/components/upload/MetadataForm'
import { createClient } from '@/lib/auth'
import { MULTIPART_PART_SIZE_BYTES, MULTIPART_THRESHOLD_BYTES } from '@/lib/upload-validation'

async function fetchAgencyId(): Promise<string> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to upload')

  const { data: membership } = await supabase
    .from('memberships')
    .select('agency_id')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.agency_id) throw new Error('No agency found for your account')
  return membership.agency_id as string
}

async function performUpload(
  f: File,
  aid: string,
  onProgress: (p: number) => void
): Promise<string> {
  const presignRes = await fetch('/api/videos/upload/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agencyId: aid,
      fileName: f.name,
      contentType: f.type,
      fileSizeBytes: f.size,
    }),
  })

  if (presignRes.status === 402) throw new Error('Storage quota exceeded')
  if (!presignRes.ok) {
    const body = (await presignRes.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Presign failed: ${presignRes.status}`)
  }

  const presign = await presignRes.json()

  if (!presign.multipart) {
    // Standard single-PUT upload with XHR for progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('PUT', presign.uploadUrl as string)
      xhr.setRequestHeader('Content-Type', f.type)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed: ${xhr.status}`))
      }
      xhr.onerror = () => reject(new Error('Network error during upload'))
      xhr.send(f)
    })
    onProgress(100)

    const completeRes = await fetch('/api/videos/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: presign.videoId,
        agencyId: aid,
        r2Key: presign.r2Key,
        fileSizeBytes: f.size,
      }),
    })
    if (!completeRes.ok) {
      const body = (await completeRes.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? 'Failed to complete upload')
    }
    return ((await completeRes.json()) as { videoId: string }).videoId
  } else {
    // Multipart upload
    const partUrls = presign.partUrls as { partNumber: number; url: string }[]
    const partCount = presign.partCount as number
    const parts: { PartNumber: number; ETag: string }[] = []

    for (let i = 0; i < partCount; i++) {
      const partNumber = i + 1
      const start = i * MULTIPART_PART_SIZE_BYTES
      const end = Math.min(start + MULTIPART_PART_SIZE_BYTES, f.size)
      const chunk = f.slice(start, end)

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
            agencyId: aid,
          }),
        })
        if (!urlRes.ok) throw new Error('Failed to get part URL')
        url = ((await urlRes.json()) as { url: string }).url
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
        agencyId: aid,
        r2Key: presign.r2Key,
        fileSizeBytes: f.size,
        r2UploadId: presign.r2UploadId,
        parts,
      }),
    })
    if (!completeRes.ok) {
      const body = (await completeRes.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? 'Failed to complete multipart upload')
    }
    return ((await completeRes.json()) as { videoId: string }).videoId
  }
}

/** Strip file extension to use as default title */
function fileNameWithoutExtension(name: string): string {
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

export default function UploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [agencyId, setAgencyId] = useState('')
  const [progress, setProgress] = useState(0)
  const [isMultipart, setIsMultipart] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string>('')

  const runUpload = useCallback(async (f: File, aid: string) => {
    setUploading(true)
    setError(null)
    setProgress(0)
    try {
      const videoId = await performUpload(f, aid, setProgress)
      setUploadedVideoId(videoId)
      setUploadedFileName(f.name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }, [])

  const handleFileSelected = useCallback(
    async (f: File) => {
      setFile(f)
      setIsMultipart(f.size > MULTIPART_THRESHOLD_BYTES)
      setError(null)
      setProgress(0)
      setUploadedVideoId(null)

      let aid = agencyId
      if (!aid) {
        try {
          aid = await fetchAgencyId()
          setAgencyId(aid)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load agency')
          return
        }
      }

      await runUpload(f, aid)
    },
    [agencyId, runUpload]
  )

  const handleRetry = useCallback(async () => {
    if (!file) return
    setError(null)

    let aid = agencyId
    if (!aid) {
      try {
        aid = await fetchAgencyId()
        setAgencyId(aid)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agency')
        return
      }
    }

    await runUpload(file, aid)
  }, [file, agencyId, runUpload])

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Upload video</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Drag and drop or select an MP4 or MOV file
        </p>
      </div>

      {!file ? (
        <UploadZone onFileSelected={handleFileSelected} disabled={uploading} />
      ) : (
        <div className="space-y-4">
          <UploadProgress
            fileName={file.name}
            percent={progress}
            isMultipart={isMultipart}
            error={error}
            onRetry={handleRetry}
          />

          {uploadedVideoId ? (
            <MetadataForm
              videoId={uploadedVideoId}
              defaultTitle={fileNameWithoutExtension(uploadedFileName)}
              onSaved={(videoId) => router.push(`/videos/${videoId}`)}
              onSkip={(videoId) => router.push(`/videos/${videoId}`)}
            />
          ) : (
            !uploading && (
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setError(null)
                  setProgress(0)
                  setUploadedVideoId(null)
                }}
                className="w-full rounded-lg border border-gray-300 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Choose different file
              </button>
            )
          )}
        </div>
      )}
    </main>
  )
}
