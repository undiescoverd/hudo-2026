/**
 * /settings/account — read-only account details + link to the existing
 * password-reset flow. No new API: name editing and self-erasure UI are not built yet.
 */
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function AccountSettingsPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/signin')

  const meta = user.user_metadata as Record<string, string> | undefined
  const name = meta?.full_name ?? meta?.name ?? null

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your sign-in details.</p>
      </div>
      <dl className="space-y-4 text-sm">
        {name && (
          <div>
            <dt className="text-faint">Name</dt>
            <dd className="mt-0.5 font-medium">{name}</dd>
          </div>
        )}
        <div>
          <dt className="text-faint">Email</dt>
          <dd className="mt-0.5 font-medium">{user.email}</dd>
        </div>
      </dl>
      <p className="mt-6 text-sm">
        <Link
          href="/auth/forgot-password"
          className="underline underline-offset-4 hover:text-foreground"
        >
          Send me a reset link
        </Link>
      </p>
    </div>
  )
}
