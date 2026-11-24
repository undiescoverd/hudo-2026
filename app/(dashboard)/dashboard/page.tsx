/**
 * /dashboard — every role's landing page (S5-NAV-001).
 *
 * Server component: renders by role via dashboardViewFor().
 * - owner | admin_agent | agent → agent dashboard (agency-wide video list).
 * - anyone else (talent, unknown) → talent dashboard (their own videos).
 * Unauthenticated → /auth/signin. /talent redirects here.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { dashboardViewFor } from '@/lib/landing'
import { getAgencyVideos } from '@/lib/dashboard'
import { getTalentVideos } from '@/lib/talent-dashboard'
import { AgentDashboard } from '@/components/dashboard/AgentDashboard'
import { TalentDashboard } from '@/components/dashboard/TalentDashboard'
import { needsTalent } from '@/components/dashboard/talent/tracker'
import { DashboardError } from '@/components/dashboard/DashboardError'
import { OnboardingChecklist } from '@/components/dashboard/OnboardingChecklist'
import { getOnboardingChecklist } from '@/lib/onboarding-checklist'
import { VideoStatusLive } from '@/components/dashboard/VideoStatusLive'
import { RefreshOnMount } from '@/components/dashboard/RefreshOnMount'

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

  if (dashboardViewFor(role) === 'talent') {
    const { data: videos, error } = await getTalentVideos({
      supabase,
      user_id: user.id,
      agency_ids,
    })

    if (error) {
      console.error('[dashboard-page] getTalentVideos failed:', error)
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
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">
            Your videos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{subline}</p>
        </div>

        {error ? <DashboardError /> : <TalentDashboard videos={videos ?? []} />}
      </main>
    )
  }

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

  // Owner-only onboarding checklist; null (hidden) when not owner, all done, or on query error.
  const checklist =
    role === 'owner' ? await getOnboardingChecklist({ supabase, userId: user.id }) : null

  return (
    <main className="mx-auto max-w-[1360px] px-7 pb-16 pt-6">
      {agent_agency_ids.map((id) => (
        <VideoStatusLive key={id} agencyId={id} />
      ))}

      <div className="mb-6">
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.03em]">Videos</h1>
        <p className="text-sm text-muted-foreground mt-1">All videos across your agencies.</p>
      </div>

      {checklist && (
        <OnboardingChecklist items={checklist.items} agencyName={checklist.agencyName} />
      )}

      {error ? <DashboardError /> : <AgentDashboard initialVideos={initialVideos ?? []} />}
    </main>
  )
}
