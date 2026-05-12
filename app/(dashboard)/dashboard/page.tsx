/**
 * /dashboard — Agent/owner dashboard page.
 *
 * Server component: role-gated, fetches initial video list, passes to client.
 * Role access: owner, admin_agent, agent.
 * talent → redirected to /talent (built in DASH-002).
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { getAgencyVideos } from '@/lib/dashboard'
import { AgentDashboard } from '@/components/dashboard/AgentDashboard'

const AGENT_PLUS_ROLES = new Set(['owner', 'admin_agent', 'agent'])

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { user, role, agency_ids } = await getCurrentUserRole(supabase)

  // Unauthenticated → redirect to sign-in
  if (!user) {
    redirect('/auth/signin')
  }

  // Talent role → redirect to talent dashboard (built in DASH-002)
  if (!AGENT_PLUS_ROLES.has(role)) {
    redirect('/talent')
  }

  // Fetch initial data server-side for first paint
  const { data: initialVideos } = await getAgencyVideos({
    supabase,
    agency_ids,
    limit: 50,
    offset: 0,
  })

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">All videos across your agencies.</p>
      </div>

      <AgentDashboard initialVideos={initialVideos} />
    </main>
  )
}
