import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  if (!UUID_RE.test(params.id)) {
    notFound()
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <VideoPlayer videoId={params.id} />
    </main>
  )
}
