import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { StatusBadge } from '@/lib/video-status'

type Video = {
  id: string
  title: string
  status: string
  thumbnail_r2_key: string | null
  created_at: string
}

export default async function VideosPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, status, thumbnail_r2_key, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-sm text-destructive">Failed to load videos.</p>
      </main>
    )
  }

  const list = (videos ?? []) as Video[]

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-semibold mb-6">Videos</h1>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No videos yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((video) => (
            <Link
              key={video.id}
              href={`/videos/${video.id}`}
              className="group block border rounded-lg overflow-hidden hover:border-foreground/30 transition-colors"
            >
              <div className="aspect-video bg-muted flex items-center justify-center">
                {video.thumbnail_r2_key ? (
                  <img
                    src={`/api/videos/${video.id}/thumbnail`}
                    alt={video.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-muted-foreground text-xs">No thumbnail</span>
                )}
              </div>

              <div className="p-3 space-y-1">
                <p className="text-sm font-medium line-clamp-1 group-hover:text-foreground transition-colors">
                  {video.title}
                </p>
                <StatusBadge status={video.status} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
