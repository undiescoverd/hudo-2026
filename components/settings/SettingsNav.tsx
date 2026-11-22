'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { SettingsNavItem } from './settings-nav-items'

/** Left sub-nav on desktop; horizontal pill row on phones. */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname()
  return (
    <nav
      aria-label="Settings"
      className="flex gap-1.5 overflow-x-auto md:grid md:gap-0.5 md:overflow-visible"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              'border border-line bg-surface md:border-transparent md:bg-transparent',
              active
                ? 'bg-foreground text-surface md:bg-surface-2 md:font-semibold md:text-foreground'
                : 'text-muted-foreground hover:text-foreground md:hover:bg-surface-2'
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
