/**
 * /settings/notifications — Notification preferences page.
 *
 * Server component: loads current prefs and passes them to the client component.
 * Any authenticated user can view and update their own preferences.
 * Defaults: email_enabled=true, batch_window_minutes=15
 */
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NotificationPreferences } from '@/components/settings/NotificationPreferences'

export default async function NotificationSettingsPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/signin')
  }

  // Load current preferences — apply defaults if no row exists
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('email_enabled, batch_window_minutes')
    .eq('user_id', user.id)
    .maybeSingle()

  const emailEnabled = prefs?.email_enabled ?? true
  const batchWindowMinutes = (prefs?.batch_window_minutes ?? 15) as 5 | 15 | 30 | 60

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Notification settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage how you receive notifications.</p>
      </div>

      <NotificationPreferences
        initialEmailEnabled={emailEnabled}
        initialBatchWindowMinutes={batchWindowMinutes}
      />
    </main>
  )
}
