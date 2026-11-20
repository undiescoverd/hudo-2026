import React from 'react'
import Link from 'next/link'

/** Legal pages linked from the footer, the register page and the cookie banner. */
export const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/dpa', label: 'Data Processing Agreement' },
] as const

export function LegalFooter() {
  return (
    <footer className="border-t px-4 py-6 text-center text-xs text-muted-foreground">
      <nav aria-label="Legal" className="flex flex-wrap justify-center gap-x-4 gap-y-2">
        {LEGAL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="underline underline-offset-4 hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3">Hudo is operated by Resolve Labs Ltd.</p>
    </footer>
  )
}
