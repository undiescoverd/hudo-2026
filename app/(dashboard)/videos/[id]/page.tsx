'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { VideoPlayerProvider } from '@/components/player/VideoPlayerProvider'
import { VersionSelector } from '@/components/versions/VersionSelector'
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

  if (!UUID_RE.test(params.id)) {
    notFound()
  }

  // Fetch the current user id once on mount
  useEffect(() => {
    const supabase = createClient()
    supabase.auth
      .getUser()
      .then(({ data: { user } }) => {
        if (user) setUserId(user.id)
      })
      .catch((err: unknown) => {
        console.error('[video-page] getUser failed:', err)
      })
  }, [])

  // Fetch agencyId from the versions endpoint once the videoId is known
  useEffect(() => {
    fetch(`/api/videos/${params.id}/versions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`versions fetch failed (${res.status})`)
        const data = (await res.json()) as { agencyId: string }
        if (data.agencyId) setAgencyId(data.agencyId)
      })
      .catch((err: unknown) => {
        console.error('[video-page] agencyId fetch failed:', err)
      })
  }, [params.id])

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
            ) : undefined
          }
        />
      </VideoPlayerProvider>
    </main>
  )
}
