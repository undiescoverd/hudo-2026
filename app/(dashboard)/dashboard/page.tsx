/**
 * /dashboard — role-branching dashboard page.
 *
 * Server component: fetches initial video list, passes to client.
 * Role access: owner, admin_agent, agent → all-agency table view.
 * talent → own-videos view.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { getAgencyVideos } from '@/lib/dashboard'
import { getTalentVideos } from '@/lib/talent-dashboard'
import { AgentDashboard } from '@/components/dashboard/AgentDashboard'
import { TalentDashboard } from '@/components/dashboard/TalentDashboard'
import { DashboardError } from '@/components/dashboard/DashboardError'
import { VideoStatusLive } from '@/components/dashboard/VideoStatusLive'

const AGENT_PLUS_ROLES = new Set(['owner', 'admin_agent', 'agent'])

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { user, role, agency_ids, agent_agency_ids } = await getCurrentUserRole(supabase)

  // Unauthenticated → redirect to sign-in
  if (!user) {
    redirect('/auth/signin')
  }

  if (AGENT_PLUS_ROLES.has(role)) {
    // Fetch initial data server-side for first paint
    // agent_agency_ids is empty only if the user has no agent-role memberships yet
    const { data: initialVideos, error } =
      agent_agency_ids.length === 0
        ? { data: [], error: null }
        : await getAgencyVideos({
            supabase,
            agency_ids: agent_agency_ids,
            limit: 50,
            offset: 0,
          })

    if (error) {
      console.error('[dashboard-page] getAgencyVideos failed:', error)
    }

    return (
      <main className="max-w-7xl mx-auto px-4 py-8">
        {agent_agency_ids.map((id) => (
          <VideoStatusLive key={id} agencyId={id} />
        ))}

        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">All videos across your agencies.</p>
        </div>

        {error ? <DashboardError /> : <AgentDashboard initialVideos={initialVideos ?? []} />}
      </main>
    )
  }

  const { data: videos, error } = await getTalentVideos({
    supabase,
    user_id: user.id,
    agency_ids,
  })

  if (error) {
    console.error('[dashboard-page] getTalentVideos failed:', error)
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      {agency_ids.map((id) => (
        <VideoStatusLive key={id} agencyId={id} />
      ))}

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">My Videos</h1>
        <p className="text-sm text-muted-foreground mt-1">Your videos across all agencies.</p>
      </div>

      {error ? <DashboardError /> : <TalentDashboard videos={videos ?? []} />}
    </main>
  )
}
