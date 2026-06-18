'use client'

/**
 * UsageBars — displays agent seats, talent seats, and storage usage as
 * labeled progress bars.
 *
 * Agent/talent limits come from PLAN_LIMITS in @/lib/plan-gates.
 * Storage limit is passed directly (storage_limit_bytes column from agencies).
 */

import { PLAN_LIMITS } from '@/lib/plan-gates'

export interface UsageBarsProps {
  plan: string
  agentCount: number
  talentCount: number
  storageUsedBytes: number
  storageLimitBytes: number
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) {
    return `${(bytes / 1_073_741_824).toFixed(1)} GB`
  }
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  }
  return `${(bytes / 1024).toFixed(0)} KB`
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
  // Fall back to freemium limits for unknown plans
  const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS.freemium

  return (
    <div className="space-y-5">
      <ProgressBar
        label="Agents"
        current={agentCount}
        limit={limits.agents}
        currentLabel={String(agentCount)}
        limitLabel={`${limits.agents} agents`}
      />
      <ProgressBar
        label="Talent"
        current={talentCount}
        limit={limits.talent}
        currentLabel={String(talentCount)}
        limitLabel={`${limits.talent} talent`}
      />
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
