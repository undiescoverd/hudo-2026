import { notFound } from 'next/navigation'
import { VideoPlayer } from '@/components/player/VideoPlayer'
import { MobilePlayerLayout } from '@/components/player/MobilePlayerLayout'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Props {
  params: { id: string }
}

export default function VideoPage({ params }: Props) {
  if (!UUID_RE.test(params.id)) {
    notFound()
  }

  return (
    <main className="min-h-screen">
      <MobilePlayerLayout player={<VideoPlayer videoId={params.id} className="h-full w-full" />} />
    </main>
  )
}
