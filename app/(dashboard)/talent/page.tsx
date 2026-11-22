/**
 * /talent — Talent dashboard page.
 *
 * Server component: role-gated, fetches talent's own videos, passes to client.
 * Role access: talent only.
 * owner | admin_agent | agent → redirected to /dashboard.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { getTalentVideos } from '@/lib/talent-dashboard'
import { TalentDashboard } from '@/components/dashboard/TalentDashboard'
import { needsTalent } from '@/components/dashboard/talent/tracker'
import { DashboardError } from '@/components/dashboard/DashboardError'
import { VideoStatusLive } from '@/components/dashboard/VideoStatusLive'
import { RefreshOnMount } from '@/components/dashboard/RefreshOnMount'

export default async function TalentPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { user, role, agency_ids } = await getCurrentUserRole(supabase)

  // Unauthenticated → redirect to sign-in
  if (!user) {
    redirect('/auth/signin')
  }

  // Agent+ roles do not belong on this page → redirect to agent dashboard
  if (role !== 'talent') {
    redirect('/dashboard')
  }

  const { data: videos, error } = await getTalentVideos({
    supabase,
    user_id: user.id,
    agency_ids,
  })

  if (error) {
    console.error('[talent-page] getTalentVideos failed:', error)
  }

  const total = videos?.length ?? 0
  const needing = (videos ?? []).filter(needsTalent).length
  const subline = `${total} video${total === 1 ? '' : 's'} · ${
    needing ? `${needing} need${needing === 1 ? 's' : ''} you` : 'nothing needs you'
  }`

  return (
    <main className="max-w-[1360px] mx-auto px-7 pt-6 pb-16">
      <RefreshOnMount />
      {agency_ids.map((id) => (
        <VideoStatusLive key={id} agencyId={id} />
      ))}

      <div className="mb-[18px]">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">Your videos</h1>
        <p className="text-sm text-muted-foreground mt-1">{subline}</p>
      </div>

      {error ? <DashboardError /> : <TalentDashboard videos={videos ?? []} />}
    </main>
  )
}
