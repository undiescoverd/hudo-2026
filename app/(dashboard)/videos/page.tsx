import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { StatusBadge } from '@/lib/video-status'
import { VideoStatusLive } from '@/components/dashboard/VideoStatusLive'

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

  const { agency_ids } = await getCurrentUserRole(supabase)

  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, title, status, thumbnail_r2_key, created_at')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return (
      <main className="mx-auto max-w-[1360px] px-7 pb-16 pt-6">
        <p className="text-sm text-destructive">Failed to load videos.</p>
      </main>
    )
  }

  const list = (videos ?? []) as Video[]

  return (
    <main className="mx-auto max-w-[1360px] px-7 pb-16 pt-6">
      {agency_ids.map((id) => (
        <VideoStatusLive key={id} agencyId={id} />
      ))}

      <h1 className="mb-6 text-[26px] font-semibold leading-tight tracking-[-0.03em]">Videos</h1>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No videos yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((video) => (
            <Link
              key={video.id}
              href={`/videos/${video.id}`}
              className="group block overflow-hidden rounded-[10px] bg-surface shadow-[inset_0_0_0_1px_var(--line)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--faint)]"
            >
              <div className="aspect-video bg-stage flex items-center justify-center">
                {video.thumbnail_r2_key ? (
                  <img
                    src={`/api/videos/${video.id}/thumbnail`}
                    alt={video.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-white/60">No thumbnail</span>
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
