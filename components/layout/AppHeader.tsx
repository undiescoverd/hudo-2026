'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { isBillingEnabled } from '@/lib/feature-flags'

type Props = {
  displayName: string
}

export function AppHeader({ displayName }: Props) {
  const pathname = usePathname()

  function navClass(href: string) {
    const active = pathname === href || pathname.startsWith(href + '/')
    return active
      ? 'text-sm font-medium text-foreground'
      : 'text-sm text-muted-foreground hover:text-foreground transition-colors'
  }

  return (
    <header className="border-b bg-background sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold text-foreground tracking-tight">
          Hudo
        </Link>

        <nav className="flex items-center gap-4">
          <Link href="/dashboard" className={navClass('/dashboard')}>
            Dashboard
          </Link>
          <Link href="/upload" className={navClass('/upload')}>
            Upload
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground hidden sm:block">{displayName}</span>
          <NotificationBell />
          {isBillingEnabled() && (
            <Link href="/settings/billing" className={navClass('/settings/billing')}>
              Billing
            </Link>
          )}
          <Link href="/settings/notifications" className={navClass('/settings/notifications')}>
            Settings
          </Link>
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
