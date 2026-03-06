'use client'

import { useState } from 'react'
import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { VersionSelector } from '@/components/versions/VersionSelector'

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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-3">
        <VersionSelector
          videoId={params.id}
          activeVersionId={activeVersionId}
          onVersionChange={setActiveVersionId}
        />
      </div>
      <VideoPlayer videoId={params.id} versionId={activeVersionId ?? undefined} />
    </main>
  )
}
