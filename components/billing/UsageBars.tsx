'use client'

/**
 * UsageBars — displays agent seats, talent seats, and storage usage as
 * labeled progress bars.
 *
 * Agent/storage limits come from lib/plans (getPlan). Talent is unlimited
 * on every tier — displayed as a count with an "Unlimited" hint, no bar fill.
 * Storage limit is passed directly (storage_limit_bytes column from agencies).
 */

import { getPlan, GiB } from '@/lib/plans'

// Binary byte scales derived from the single GiB source in lib/plans.ts — no
// second copy of the byte convention (the PR's single-source thesis).
const TiB = GiB * 1024
const MiB = 1024 ** 2
const KiB = 1024

export interface UsageBarsProps {
  plan: string
  agentCount: number
  talentCount: number
  storageUsedBytes: number
  storageLimitBytes: number
}

export function formatBytes(bytes: number): string {
  if (bytes >= TiB) {
    return `${(bytes / TiB).toFixed(1)} TB`
  }
  if (bytes >= GiB) {
    return `${(bytes / GiB).toFixed(1)} GB`
  }
  if (bytes >= MiB) {
    return `${(bytes / MiB).toFixed(1)} MB`
  }
  return `${(bytes / KiB).toFixed(0)} KB`
}

function ProgressBar({
  label,
  current,
  limit,
  currentLabel,
  limitLabel,
}: {
  label: string
  current: number
  limit: number
  currentLabel: string
  limitLabel: string
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0
  const isWarning = pct >= 80
  const isFull = pct >= 100

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {currentLabel} / {limitLabel}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isFull ? 'bg-destructive' : isWarning ? 'bg-amber-500' : 'bg-primary'
          }`}
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-label={`${label}: ${currentLabel} of ${limitLabel}`}
        />
      </div>
    </div>
  )
}

export function UsageBars({
  plan,
  agentCount,
  talentCount,
  storageUsedBytes,
  storageLimitBytes,
}: UsageBarsProps) {
  const planData = getPlan(plan)

  return (
    <div className="space-y-5">
      <ProgressBar
        label="Agents"
        current={agentCount}
        limit={planData.agentSeats}
        currentLabel={String(agentCount)}
        limitLabel={`${planData.agentSeats} agents`}
      />

      {/* Talent is unlimited — show count + hint, no progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Talent</span>
          <span className="text-muted-foreground tabular-nums">
            {talentCount} <span className="text-xs font-normal">Unlimited</span>
          </span>
        </div>
      </div>

      <ProgressBar
        label="Storage"
        current={storageUsedBytes}
        limit={storageLimitBytes}
        currentLabel={formatBytes(storageUsedBytes)}
        limitLabel={formatBytes(storageLimitBytes)}
      />
    </div>
  )
}
