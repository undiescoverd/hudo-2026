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
import { VideoStatusControl } from '@/components/video/VideoStatusControl'
import { useVideoComments } from '@/hooks/useVideoComments'
import { createClient } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS_CONTROL_ROLES = new Set(['owner', 'admin_agent', 'agent'])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [agencyId, setAgencyId] = useState<string | null>(null)
  // The viewer's role in this video's agency, from the versions endpoint. It gates
  // Share and which comment actions render (the APIs re-check both). null = not
  // loaded yet, or the lookup failed: agent-only controls never flash for talent.
  const [role, setRole] = useState<string | null>(null)
  // null = still loading (or not yet retried); passed straight through to
  // VersionSelector so it doesn't issue its own duplicate GET request.
  const [versions, setVersions] = useState<Version[] | null>(null)
  // The video's status and owning talent, read under RLS (agents see their agency's
  // videos, talent only their own). null = not loaded or lookup failed: the
  // resubmit prompt then simply doesn't render.
  const [videoRow, setVideoRow] = useState<{ status: string; talentId: string | null } | null>(null)
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
        const data = (await res.json()) as {
          agencyId: string
          role?: string
          versions: Version[]
        }
        if (data.agencyId) setAgencyId(data.agencyId)
        if (data.role) setRole(data.role)
        // Share stays hidden without a role — make that contract break visible.
        else console.warn('[video-page] versions response missing role; hiding Share')
        setVersions(data.versions ?? [])
      })
      .catch((err: unknown) => {
        console.error('[video-page] agencyId fetch failed:', err)
        setBootstrapError('Unable to load comments right now.')
      })
  }, [params.id])

  // Minimum fields for the resubmit prompt. Non-fatal: on failure the prompt is hidden.
  const fetchVideoRow = useCallback(async () => {
    try {
      const { data, error } = await createClient()
        .from('videos')
        .select('status, talent_id')
        .eq('id', params.id)
        .maybeSingle()
      if (error) throw error
      setVideoRow(data ? { status: data.status, talentId: data.talent_id ?? null } : null)
    } catch (err: unknown) {
      console.error('[video-page] video status fetch failed:', err)
    }
  }, [params.id])

  // Live video events refresh both the versions list and the status.
  const refreshLive = useCallback(() => {
    void fetchVersions()
    void fetchVideoRow()
  }, [fetchVersions, fetchVideoRow])

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

  useEffect(() => {
    if (!isValidId) return
    void fetchVideoRow()
  }, [isValidId, fetchVideoRow])

  // Only the owning talent is prompted to resubmit: the versions endpoint reports
  // role 'talent' for them, and the video's talent_id must be the signed-in user.
  const needsResubmit =
    videoRow?.status === 'changes_requested' &&
    role === 'talent' &&
    userId !== null &&
    videoRow.talentId === userId

  // Status control: explicit role set (owner | admin_agent | agent); talent never see it.
  // The PATCH route re-checks the role server-side.
  const canChangeStatus = role !== null && STATUS_CONTROL_ROLES.has(role)
  const openCommentCount = useMemo(
    () => comments.filter((c) => !c.resolved && !c.deletedAt && c.parentId === null).length,
    [comments]
  )

  if (!isValidId) {
    notFound()
  }

  return (
    <main className="min-h-screen bg-background">
      {/* This page is a client component fed by client-side fetches, so
          router.refresh() would be a no-op here — pass fetchVersions so live
          video events re-pull the versions list instead. */}
      {agencyId && <VideoStatusLive agencyId={agencyId} onChange={refreshLive} />}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <Link href="/videos" className="text-sm text-faint transition-colors hover:text-foreground">
          ← Back to videos
        </Link>
        <div className="flex items-center gap-2">
          {/* agencyId is only set once the versions endpoint returned 200, which
              proves the viewer is the owning talent or a non-talent member. */}
          {agencyId && (
            <Link
              href={`/upload?videoId=${params.id}`}
              className={cn(
                buttonVariants({ variant: needsResubmit ? 'primary' : 'ghost' }),
                'h-[34px]',
                !needsResubmit && 'ring-1 ring-inset ring-line hover:bg-surface-2'
              )}
            >
              Upload new version
            </Link>
          )}
          <GuestShareButton videoId={params.id} role={role} />
        </div>
      </div>
      {canChangeStatus && videoRow && (
        <div className="border-b border-line bg-surface px-5 py-2.5">
          <VideoStatusControl
            videoId={params.id}
            status={videoRow.status}
            refreshKey={openCommentCount}
            onChanged={refreshLive}
          />
        </div>
      )}
      {needsResubmit && (
        <div
          data-testid="resubmit-banner"
          role="status"
          className="border-b border-line bg-coral-soft px-5 py-2.5 text-sm font-semibold text-coral-text"
        >
          Changes requested. Upload a new version
        </div>
      )}
      <div className="px-5 pt-3">
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
