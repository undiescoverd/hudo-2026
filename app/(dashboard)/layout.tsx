import { AppHeader } from '@/components/layout/AppHeader'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { user, role } = await getCurrentUserRole(supabase)

  const meta = user?.user_metadata as Record<string, string> | undefined
  const displayName = meta?.full_name ?? meta?.name ?? user?.email?.split('@')[0] ?? 'User'

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader displayName={displayName} role={role} />
      <div className="flex-1">{children}</div>
    </div>
  )
}
