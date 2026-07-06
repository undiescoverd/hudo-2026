'use client'

import { useState } from 'react'

/**
 * Local-only convenience: one-click sign-in for each seeded role, so manual
 * testing doesn't require retyping credentials. Run `node --env-file=.env.local
 * scripts/seed-dev.mjs` once to create these users in hudo-dev.
 *
 * This module is only ever imported by signin-form.tsx behind a
 * `process.env.NODE_ENV === 'development'` check, which Next.js dead-code-eliminates
 * from production/preview builds — it never ships to a deployed environment.
 */
const DEV_PASSWORD = 'HudoDevQuick2026!'
const DEV_ACCOUNTS = [
  { label: 'Owner', email: 'owner@hudo-dev.test' },
  { label: 'Admin agent', email: 'admin@hudo-dev.test' },
  { label: 'Agent', email: 'agent@hudo-dev.test' },
  { label: 'Talent', email: 'talent@hudo-dev.test' },
] as const

export default function DevQuickSignIn({ redirect }: { redirect: string }) {
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function quickSignIn(email: string) {
    setPending(email)
    setError(null)
    try {
      const res = await fetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: DEV_PASSWORD }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? `Sign in failed for ${email} — run scripts/seed-dev.mjs first?`)
        setPending(null)
        return
      }
      window.location.href = redirect
    } catch {
      setError('Network error during quick sign-in.')
      setPending(null)
    }
  }

  return (
    <div className="w-full max-w-sm space-y-2 rounded-md border border-dashed border-amber-500 bg-amber-50 p-4 dark:bg-amber-950">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Dev quick sign-in (local only)
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DEV_ACCOUNTS.map((account) => (
          <button
            key={account.email}
            type="button"
            onClick={() => quickSignIn(account.email)}
            disabled={pending !== null}
            className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs font-medium hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900 dark:hover:bg-amber-800"
          >
            {pending === account.email ? 'Signing in…' : account.label}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[11px] text-amber-700 dark:text-amber-400">
        Guests aren&apos;t login-based — generate a guest link from a video page once signed in as
        agent or talent.
      </p>
    </div>
  )
}
