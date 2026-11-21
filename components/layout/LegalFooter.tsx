import React from 'react'
import Link from 'next/link'

export const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/dpa', label: 'Data Processing Agreement' },
] as const

/** Shared footer for the public legal pages (/terms, /privacy, /dpa). */
export function LegalFooter() {
  return (
    <footer className="border-t px-4 py-6 text-sm text-muted-foreground">
      <nav aria-label="Legal" className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2">
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
    </footer>
  )
}
