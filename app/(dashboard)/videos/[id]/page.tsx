'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { VideoPlayerProvider } from '@/components/player/VideoPlayerProvider'
import { VersionSelector, type Version } from '@/components/versions/VersionSelector'
import { MobilePlayerLayout } from '@/components/player/MobilePlayerLayout'
import { GuestShareButton } from '@/components/guest/GuestShareButton'
import { CommentPanel } from '@/components/comments/CommentPanel'
import { createClient } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [agencyId, setAgencyId] = useState<string | null>(null)
  // null = still loading (or not yet retried); passed straight through to
  // VersionSelector so it doesn't issue its own duplicate GET request.
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  // Validate up front, but declare all hooks before the conditional notFound()
  // below so hook order stays stable (React rules-of-hooks).
  const isValidId = UUID_RE.test(params.id)

  // Fetch the current user id once on mount
  const fetchUser = useCallback(() => {
    const supabase = createClient()
    return supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!user) throw new Error('Not signed in')
        setUserId(user.id)
      })
      .catch((err: unknown) => {
        console.error('[video-page] getUser failed:', err)
        setBootstrapError('Unable to load comments right now.')
      })
  }, [])

  // Fetch agencyId + versions from the single versions endpoint. VersionSelector
  // receives the same `versions` array as a prop so it never has to re-fetch it.
  const fetchVersions = useCallback(() => {
    return fetch(`/api/videos/${params.id}/versions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`versions fetch failed (${res.status})`)
        const data = (await res.json()) as { agencyId: string; versions: Version[] }
        if (data.agencyId) setAgencyId(data.agencyId)
        setVersions(data.versions ?? [])
      })
      .catch((err: unknown) => {
        console.error('[video-page] agencyId fetch failed:', err)
        setBootstrapError('Unable to load comments right now.')
      })
  }, [params.id])

  const retryBootstrap = useCallback(() => {
    setBootstrapError(null)
    void fetchUser()
    void fetchVersions()
  }, [fetchUser, fetchVersions])

  useEffect(() => {
    if (!isValidId) return
    void fetchUser()
  }, [isValidId, fetchUser])

  useEffect(() => {
    if (!isValidId) return
    void fetchVersions()
  }, [isValidId, fetchVersions])

  if (!isValidId) {
    notFound()
  }

  return (
    <main className="min-h-screen">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <Link
          href="/videos"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to videos
        </Link>
        <GuestShareButton videoId={params.id} />
      </div>
      <div className="px-4 pt-2">
        <VersionSelector
          videoId={params.id}
          activeVersionId={activeVersionId}
          onVersionChange={setActiveVersionId}
          versions={versions}
        />
      </div>
      <VideoPlayerProvider>
        <MobilePlayerLayout
          player={
            <VideoPlayer
              videoId={params.id}
              versionId={activeVersionId ?? undefined}
              className="h-full w-full"
            />
          }
          panel={
            activeVersionId && userId && agencyId ? (
              <CommentPanel
                videoId={params.id}
                versionId={activeVersionId}
                agencyId={agencyId}
                userId={userId}
              />
            ) : bootstrapError ? (
              <div className="p-4">
                <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/40">
                  <div className="flex items-center justify-between gap-3">
                    <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                      {bootstrapError}
                    </p>
                    <button
                      type="button"
                      onClick={retryBootstrap}
                      className="shrink-0 rounded-md bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300 dark:hover:bg-red-800"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              </div>
            ) : undefined
          }
        />
      </VideoPlayerProvider>
    </main>
  )
}
