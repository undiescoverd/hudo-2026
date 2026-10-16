'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UploadZone } from '@/components/upload/UploadZone'
import { UploadProgress } from '@/components/upload/UploadProgress'
import { MetadataForm } from '@/components/upload/MetadataForm'
import { createClient } from '@/lib/auth'
import { MULTIPART_THRESHOLD_BYTES } from '@/lib/upload-validation'
import { performUpload } from '@/lib/upload-client'
import { fetchTalentRoster, isAgentClassRole, type TalentRosterEntry } from '@/lib/talent-roster'

async function fetchMembership(): Promise<{ agencyId: string; role: string }> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('You must be signed in to upload')

  const { data: membership } = await supabase
    .from('memberships')
    .select('agency_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .single()

  if (!membership?.agency_id) throw new Error('No agency found for your account')
  return { agencyId: membership.agency_id as string, role: membership.role as string }
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
  const [role, setRole] = useState('')
  const [ready, setReady] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [roster, setRoster] = useState<TalentRosterEntry[]>([])
  const [talentId, setTalentId] = useState('')
  const [progress, setProgress] = useState(0)
  const [isMultipart, setIsMultipart] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string>('')
  // The draft video created by the first presign. Retries reuse it so a failed
  // upload never leaves a new empty draft behind per attempt.
  const draftVideoIdRef = useRef<string | undefined>(undefined)

  const needsTalent = isAgentClassRole(role)

  const loadContext = useCallback(async () => {
    setSetupError(null)
    try {
      const membership = await fetchMembership()
      if (isAgentClassRole(membership.role)) {
        setRoster(await fetchTalentRoster(createClient(), membership.agencyId))
      }
      setAgencyId(membership.agencyId)
      setRole(membership.role)
      setReady(true)
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to load agency')
    }
  }, [])

  useEffect(() => {
    void loadContext()
  }, [loadContext])

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
          // Talent role: never send talentId (the server forces it to the caller).
          talentId: needsTalent ? talentId : undefined,
          onVideoId: (id) => {
            draftVideoIdRef.current = id
          },
        })
        setUploadedVideoId(videoId)
        setUploadedFileName(f.name)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed')
      } finally {
        setUploading(false)
      }
    },
    [agencyId, needsTalent, talentId]
  )

  const handleFileSelected = useCallback(
    async (f: File) => {
      if (!ready || (needsTalent && !talentId)) return
      setFile(f)
      setIsMultipart(f.size > MULTIPART_THRESHOLD_BYTES)
      setError(null)
      setProgress(0)
      setUploadedVideoId(null)
      draftVideoIdRef.current = undefined
      await runUpload(f)
    },
    [ready, needsTalent, talentId, runUpload]
  )

  const handleRetry = useCallback(async () => {
    if (!file) return
    await runUpload(file)
  }, [file, runUpload])

  const noTalent = ready && needsTalent && roster.length === 0
  const zoneDisabled = uploading || !ready || (needsTalent && !talentId)

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">Upload video</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Drag and drop or select an MP4 or MOV file
        </p>
      </div>

      {setupError && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
          <p className="text-sm text-red-700 dark:text-red-400">{setupError}</p>
          <button
            type="button"
            onClick={() => void loadContext()}
            className="shrink-0 rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200"
          >
            Retry
          </button>
        </div>
      )}

      {!file ? (
        <div className="space-y-4">
          {ready && needsTalent && (
            <div>
              {noTalent ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  Invite a talent to this agency before uploading
                </p>
              ) : (
                <>
                  <label
                    htmlFor="upload-talent"
                    className="mb-1 block text-sm font-medium text-gray-900 dark:text-gray-100"
                  >
                    Talent
                  </label>
                  <select
                    id="upload-talent"
                    value={talentId}
                    onChange={(e) => setTalentId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Select a talent…</option>
                    {roster.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.fullName} ({t.email})
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>
          )}
          <UploadZone onFileSelected={handleFileSelected} disabled={zoneDisabled || noTalent} />
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
              {role === 'talent' && <p className="text-sm text-gray-500">Submitted for review</p>}
              <MetadataForm
                videoId={uploadedVideoId}
                defaultTitle={fileNameWithoutExtension(uploadedFileName)}
                onSaved={(videoId) => router.push(`/videos/${videoId}`)}
                onSkip={(videoId) => router.push(`/videos/${videoId}`)}
              />
            </>
          ) : (
            !uploading && (
              <button
                type="button"
                onClick={() => {
                  setFile(null)
                  setError(null)
                  setProgress(0)
                  setUploadedVideoId(null)
                  draftVideoIdRef.current = undefined
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
