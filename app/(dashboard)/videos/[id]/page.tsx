'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { VersionSelector } from '@/components/versions/VersionSelector'
import { MobilePlayerLayout } from '@/components/player/MobilePlayerLayout'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)

  if (!UUID_RE.test(params.id)) {
    notFound()
  }

  return (
    <main className="min-h-screen">
      <div className="px-4 pt-4">
        <VersionSelector
          videoId={params.id}
          activeVersionId={activeVersionId}
          onVersionChange={setActiveVersionId}
        />
      </div>
      <MobilePlayerLayout
        player={
          <VideoPlayer
            videoId={params.id}
            versionId={activeVersionId ?? undefined}
            className="h-full w-full"
          />
        }
      />
    </main>
  )
}
