'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { UploadZone } from '@/components/upload/UploadZone'
import { UploadProgress } from '@/components/upload/UploadProgress'
import { MetadataForm } from '@/components/upload/MetadataForm'
import { createClient } from '@/lib/auth'
import { MULTIPART_THRESHOLD_BYTES } from '@/lib/upload-validation'
import { attachBeforeUnloadGuard, performUpload } from '@/lib/upload-client'
import { parseTargetVideoId } from '@/lib/new-version-upload'

async function fetchMembership(): Promise<{ agencyId: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to upload')

  const { data: membership, error } = await supabase
    .from('memberships')
    .select('agency_id')
    .eq('user_id', user.id)
    // Only talent upload (S5-NAV-006). A user can be an agent in one agency and talent in
    // another; pick the talent membership, not whichever row comes first.
    .eq('role', 'talent')
    // Deterministic until the 2+ agency chooser lands (S5-NAV-007): oldest membership first.
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[upload] talent membership query failed:', error.message)
    throw new Error('Could not load your agency. Refresh and try again.')
  }
  if (!membership?.agency_id) throw new Error('Only talent can upload videos')
  return { agencyId: membership.agency_id as string }
}

/** Strip file extension to use as default title */
function fileNameWithoutExtension(name: string): string {
  const lastDot = name.lastIndexOf('.')
  return lastDot > 0 ? name.slice(0, lastDot) : name
}

interface UploadPageProps {
  searchParams?: { videoId?: string | string[] }
}

export default function UploadPage({ searchParams }: UploadPageProps) {
  // Version mode: /upload?videoId=<id> adds a new version to an existing video.
  const targetVideoId = parseTargetVideoId(searchParams?.videoId)
  const [targetTitle, setTargetTitle] = useState<string | null>(null)
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [agencyId, setAgencyId] = useState('')
  const [ready, setReady] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [isMultipart, setIsMultipart] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string>('')
  // The draft video created by the first presign. Retries reuse it so a failed
  // upload never leaves a new empty draft behind per attempt.
  const draftVideoIdRef = useRef<string | undefined>(targetVideoId)
  // Next may reuse this component across /upload?videoId=A → B (or → /upload),
  // so keep the ref in step with the URL rather than only the first mount.
  useEffect(() => {
    draftVideoIdRef.current = targetVideoId
  }, [targetVideoId])

  const loadContext = useCallback(async () => {
    setSetupError(null)
    try {
      const membership = await fetchMembership()
      let resolvedAgencyId = membership.agencyId
      if (targetVideoId) {
        // RLS-scoped lookup. A miss (unknown, foreign or not-allowed id) stops
        // here with a clear error, before the user picks a file. The presign
        // route still enforces agency + ownership server-side.
        const { data: video, error: videoError } = await createClient()
          .from('videos')
          .select('title, agency_id')
          .eq('id', targetVideoId)
          .maybeSingle()
        if (videoError) throw new Error('Failed to load video')
        if (!video?.agency_id) {
          setSetupError('Video not found, or you can’t upload a new version of it')
          return
        }
        resolvedAgencyId = video.agency_id as string
        setTargetTitle((video.title as string | null) ?? null)
      }
      setAgencyId(resolvedAgencyId)
      setReady(true)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to load agency')
    }
  }, [targetVideoId])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

  // Warn before closing the tab mid-upload (first uploads and new versions).
  useEffect(() => {
    if (!uploading) return
    return attachBeforeUnloadGuard(window)
  }, [uploading])

  const runUpload = useCallback(
    async (f: File) => {
      setUploading(true)
      setError(null)
      setProgress(0)
      try {
        const videoId = await performUpload(f, {
          agencyId,
          onProgress: setProgress,
          videoId: draftVideoIdRef.current,
          onVideoId: (id) => {
            draftVideoIdRef.current = id
          },
        })
        if (targetVideoId) {
          router.push(`/videos/${targetVideoId}`)
          return
        }
        setUploadedVideoId(videoId)
        setUploadedFileName(f.name)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [agencyId, targetVideoId, router]
  )

  const handleFileSelected = useCallback(
    async (f: File) => {
      if (!ready) return
      setFile(f)
      setIsMultipart(f.size > MULTIPART_THRESHOLD_BYTES)
      setError(null)
      setProgress(0)
      setUploadedVideoId(null)
      draftVideoIdRef.current = targetVideoId
      await runUpload(f)
    },
    [ready, runUpload, targetVideoId]
  )

  const handleRetry = useCallback(async () => {
    if (!file) return
    await runUpload(file)
  }, [file, runUpload])

  const zoneDisabled = uploading || !ready

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-gray-900">
          {targetVideoId ? 'Upload new version' : 'Upload video'}
        </h1>
        {targetVideoId && targetTitle && (
          <p className="mt-1 text-sm font-medium text-gray-900">of “{targetTitle}”</p>
        )}
        <p className="mt-1 text-sm text-gray-600">
          {targetVideoId
            ? 'Drag and drop or select an MP4 or MOV file. Status stays as it is.'
            : 'Drag and drop or select an MP4 or MOV file'}
        </p>
      </div>

      {setupError && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-status-changes-bg p-3"
        >
          <p className="text-sm text-status-changes-fg">{setupError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadContext()}>
            Retry
          </Button>
        </div>
      )}

      {!file ? (
        <div className="space-y-4">
          <UploadZone
            onFileSelected={handleFileSelected}
            disabled={zoneDisabled}
            isNewVersion={Boolean(targetVideoId)}
          />
        </div>
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
            <>
              <p className="text-sm text-gray-600">Submitted for review</p>
              <MetadataForm
                videoId={uploadedVideoId}
                defaultTitle={fileNameWithoutExtension(uploadedFileName)}
                onSaved={(videoId) => router.push(`/videos/${videoId}`)}
                onSkip={(videoId) => router.push(`/videos/${videoId}`)}
              />
            </>
          ) : (
            !uploading && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setFile(null)
                  setError(null)
                  setProgress(0)
                  setUploadedVideoId(null)
                  draftVideoIdRef.current = targetVideoId
                }}
                className="w-full"
              >
                Choose different file
              </Button>
            )
          )}
        </div>
      )}
    </main>
  )
}
