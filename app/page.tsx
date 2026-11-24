import { redirect } from 'next/navigation'
import { HOME_PATH } from '@/lib/landing'
import { createSupabaseServerClient } from '@/lib/supabase-server'

export default async function RootPage() {
  const supabase = await createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    redirect(HOME_PATH)
  } else {
    redirect('/auth/signin')
  }
}
