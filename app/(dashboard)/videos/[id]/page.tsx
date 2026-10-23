'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { VideoPlayerProvider } from '@/components/player/VideoPlayerProvider'
import { VersionSelector, type Version } from '@/components/versions/VersionSelector'
import { MobilePlayerLayout } from '@/components/player/MobilePlayerLayout'
import { GuestShareButton } from '@/components/guest/GuestShareButton'
import { CommentPanel } from '@/components/comments/CommentPanel'
import { VideoStatusLive } from '@/components/dashboard/VideoStatusLive'
import { useVideoComments } from '@/hooks/useVideoComments'
import { createClient } from '@/lib/auth'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [agencyId, setAgencyId] = useState<string | null>(null)
  // The viewer's role in this video's agency; gates which comment actions render
  // (the API re-checks them). null = not loaded yet, or the lookup failed: no actions.
  const [role, setRole] = useState<string | null>(null)
  // null = still loading (or not yet retried); passed straight through to
  // VersionSelector so it doesn't issue its own duplicate GET request.
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [bootstrapError, setBootstrapError] = useState<string | null>(null)

  // Validate up front, but declare all hooks before the conditional notFound()
  // below so hook order stays stable (React rules-of-hooks).
  const isValidId = UUID_RE.test(params.id)

  // Single source of truth for this version's comments — fetched once here and
  // shared by CommentPanel (thread/input) and VideoPlayer (CommentTimeline
  // markers) so there is exactly ONE fetch of the comments endpoint. Realtime
  // inserts/updates flow into the same state, so timeline markers stay in
  // sync with the panel automatically.
  const {
    comments,
    loading: commentsLoading,
    error: commentsError,
    handleInsert: handleCommentInsert,
    handleOptimisticRollback: handleCommentRollback,
    resolveComment,
    editComment,
    deleteComment,
  } = useVideoComments(params.id, activeVersionId)

  // Timeline markers anchor top-level comments only: a reply continues its parent's
  // thread (it carries the parent's timestamp) and must not add a second marker.
  const timelineComments = useMemo(() => comments.filter((c) => c.parentId === null), [comments])

  // Fetch the current user id once on mount
  const fetchUser = useCallback(() => {
    const supabase = createClient()
    return supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (!user) throw new Error('Not signed in')
        setUserId(user.id)
        // Used only to show the author's name on their own optimistic comment
        // before the POST response (which carries the canonical name) lands.
        const metaName = user.user_metadata?.full_name
        setUserName(typeof metaName === 'string' && metaName.trim() ? metaName.trim() : null)
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

  // Role in the video's agency, read from `memberships` under RLS (members can read
  // their own agency's rows) as the upload page does. Needs both ids, so it runs
  // after the two bootstrap fetches. On failure the panel just renders without actions.
  useEffect(() => {
    if (!isValidId || !userId || !agencyId) return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await createClient()
          .from('memberships')
          .select('role')
          .eq('user_id', userId)
          .eq('agency_id', agencyId)
          .single()
        if (error || !data) throw error ?? new Error('No membership found')
        if (!cancelled) setRole(typeof data.role === 'string' ? data.role : null)
      } catch (err) {
        console.error('[video-page] role fetch failed:', err)
        if (!cancelled) setRole(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isValidId, userId, agencyId])

  if (!isValidId) {
    notFound()
  }

  return (
    <main className="min-h-screen">
      {/* This page is a client component fed by client-side fetches, so
          router.refresh() would be a no-op here — pass fetchVersions so live
          video events re-pull the versions list instead. */}
      {agencyId && <VideoStatusLive agencyId={agencyId} onChange={fetchVersions} />}
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
              comments={timelineComments}
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
                currentUserName={userName}
                viewerRole={role}
                comments={comments}
                loading={commentsLoading}
                error={commentsError}
                onOptimisticInsert={handleCommentInsert}
                onOptimisticRollback={handleCommentRollback}
                onResolveComment={resolveComment}
                onEditComment={editComment}
                onDeleteComment={deleteComment}
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
