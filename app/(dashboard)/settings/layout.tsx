import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getCurrentUserRole } from '@/lib/auth-helpers'
import { isBillingEnabled } from '@/lib/feature-flags'
import { getUserBillingAccess } from '@/lib/billing-access'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { settingsNavItems } from '@/components/settings/settings-nav-items'

/** v3 settings shell: side nav + content pane. Pages enforce their own access. */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const { user, role } = await getCurrentUserRole(supabase)
  const { isDelegate } = user
    ? await getUserBillingAccess(supabase, user.id)
    : { isDelegate: false }
  const items = settingsNavItems(role, isBillingEnabled(), isDelegate)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:grid md:grid-cols-[200px_1fr] md:gap-10">
      <aside className="mb-6 md:mb-0">
        <p className="mb-3 hidden px-3 text-xs font-medium uppercase tracking-wide text-faint md:block">
          Settings
        </p>
        <SettingsNav items={items} />
      </aside>
      <main className="min-w-0 max-w-2xl">{children}</main>
    </div>
  )
}
