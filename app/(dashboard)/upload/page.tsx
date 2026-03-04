'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { useUpload } from '@/hooks/useUpload'
import { UploadZone } from '@/components/upload/UploadZone'
import { UploadProgress } from '@/components/upload/UploadProgress'

export default function UploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const agencyId = searchParams.get('agencyId')

  const { state, upload, reset } = useUpload()

  // Redirect to sign-in if no session (middleware handles most cases,
  // but this is a lightweight client-side guard for the upload page).
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) return

    const supabase = createClient(supabaseUrl, supabaseAnonKey)
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        router.replace('/auth/signin')
      }
    })
  }, [router])

  // Navigate to video page on success
  useEffect(() => {
    if (state.status === 'success') {
      router.push(`/videos/${state.videoId}`)
    }
  }, [state, router])

  if (!agencyId) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-destructive">Missing agency. Please use a valid upload link.</p>
      </main>
    )
  }

  function handleFile(file: File) {
    if (agencyId) {
      upload(file, agencyId)
    }
  }

  function handleRetry() {
    reset()
  }

  return (
    <main className="mx-auto max-w-lg space-y-6 p-6 pt-12">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Upload video</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload an MP4 or MOV file — videos go directly to storage.
        </p>
      </div>

      {(state.status === 'idle' || state.status === 'error') && (
        <UploadZone
          onFile={handleFile}
          error={state.status === 'error' ? state.message : undefined}
          disabled={false}
        />
      )}

      {(state.status === 'uploading' || state.status === 'error') && (
        <UploadProgress
          progress={state.status === 'uploading' ? state.progress : 0}
          status={state.status === 'error' ? 'error' : 'uploading'}
          error={state.status === 'error' ? state.message : undefined}
          onRetry={state.status === 'error' ? handleRetry : undefined}
        />
      )}
    </main>
  )
}
