import { AppHeader } from '@/components/layout/AppHeader'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let role = 'talent'
  if (user) {
    const { data: memberships } = await supabase
      .from('memberships')
      .select('role')
      .eq('user_id', user.id)

    const HIERARCHY = ['owner', 'admin_agent', 'agent', 'talent']
    const roles = (memberships ?? []).map((m: { role: string }) => m.role)
    if (roles.length > 0) {
      roles.sort((a: string, b: string) => HIERARCHY.indexOf(a) - HIERARCHY.indexOf(b))
      role = roles[0]
    }
  }

  const displayName =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email?.split('@')[0] ??
    'User'

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader displayName={displayName} role={role} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
