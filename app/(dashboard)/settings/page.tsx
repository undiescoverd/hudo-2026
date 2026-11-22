import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'
import { settingsNavItems } from '@/components/settings/settings-nav-items'

/** /settings has no content of its own: send people to their first allowed section. */
export default async function SettingsIndexPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { user, role } = await getCurrentUserRole(supabase)
  if (!user) redirect('/auth/signin')
  redirect(settingsNavItems(role, isBillingEnabled())[0].href)
}
