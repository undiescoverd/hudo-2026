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

  const { data: videos } = await getTalentVideos({
    supabase,
    user_id: user.id,
    agency_ids,
  })

  return (
    <main className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">My Videos</h1>
        <p className="text-sm text-muted-foreground mt-1">Your videos across all agencies.</p>
      </div>

      <TalentDashboard videos={videos ?? []} />
    </main>
  )
}
