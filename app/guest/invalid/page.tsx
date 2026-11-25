/**
 * /guest/invalid — shown when a guest link can't be opened. Generic by design
 * (GH #171): no lookups, no names, dates or billing details. The only input is
 * an allowlisted `reason` word; anything else renders the not-found copy and
 * nothing from the query string is ever echoed into the page.
 */
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { copyForReason, type InvalidCopy } from './copy'

export const metadata: Metadata = {
  title: 'Link unavailable — Hudo',
  referrer: 'no-referrer',
}

const ICON_PATHS: Record<InvalidCopy['icon'], ReactNode> = {
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  blocked: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.5a2.5 2.5 0 114 2c-.9.6-1.6 1-1.6 2M12 17h.01" />
    </>
  ),
}

export default function GuestInvalidPage({
  searchParams,
}: {
  searchParams?: { reason?: string | string[] }
}) {
  const { title, body, icon } = copyForReason(searchParams?.reason)
  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="flex h-14 shrink-0 items-center border-b border-line bg-surface px-8">
        <span className="text-xl font-semibold tracking-tight">hudo</span>
      </header>
      <main className="flex grow flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="text-gray-600"
          >
            {ICON_PATHS[icon]}
          </svg>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-[380px] text-sm text-gray-600">{body}</p>
      </main>
      <footer className="pb-6 pt-3 text-center text-[11.5px] text-faint">Powered by hudo</footer>
    </div>
  )
}
