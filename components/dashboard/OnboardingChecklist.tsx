/**
 * OnboardingChecklist — owner-only "get started" card on /dashboard.
 * Presentational server component; visibility is decided by getOnboardingChecklist.
 */

import React from 'react'
import Link from 'next/link'
import type { ChecklistItem } from '@/lib/onboarding-checklist'

type Props = {
  items: ChecklistItem[]
  agencyName?: string | null
}

export function OnboardingChecklist({ items, agencyName }: Props) {
  const doneCount = items.filter((i) => i.done).length
  return (
    <section
      aria-labelledby="onboarding-heading"
      className="mb-6 rounded-[10px] bg-surface p-4 shadow-[inset_0_0_0_1px_var(--line)]"
      data-testid="onboarding-checklist"
    >
      <h2 id="onboarding-heading" className="text-base font-semibold">
        Get started{agencyName ? ` — ${agencyName}` : ''} ({doneCount} of {items.length} done)
      </h2>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.key} className="flex items-start gap-3 text-sm">
            <span aria-hidden="true" className="mt-0.5">
              {item.done ? '✓' : '○'}
            </span>
            {item.done ? (
              <span className="text-muted-foreground line-through">
                {item.label}
                <span className="sr-only"> (done)</span>
              </span>
            ) : (
              <span>
                <Link href={item.href} className="font-medium underline underline-offset-2">
                  {item.label}
                </Link>
                <span className="block text-muted-foreground">{item.description}</span>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
