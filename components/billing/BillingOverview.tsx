'use client'

/**
 * BillingOverview — displays plan status, usage, and upgrade/portal actions.
 *
 * Upgrade flow:
 *   1. Click "Upgrade to <plan>" button.
 *   2. If legal entity data is incomplete, show LegalEntityForm (PATCH /api/agencies/[id]/billing).
 *   3. Once legal data is saved, show DpaAcceptanceModal (POST /api/agencies/[id]/dpa-accept).
 *   4. Once DPA is accepted, POST /api/agencies/[id]/billing { plan, interval } → redirect to { url }.
 *
 * The server re-validates all preconditions on POST regardless of UI state,
 * so the UI just needs to surface the steps to the user.
 */

import { useState } from 'react'
import { UsageBars, formatBytes } from '@/components/billing/UsageBars'
import { LegalEntityForm, type LegalEntityData } from '@/components/billing/LegalEntityForm'
import { DpaAcceptanceModal } from '@/components/billing/DpaAcceptanceModal'
import { PLAN_IDS, PLANS, getPlan, type BillingInterval, type PlanId } from '@/lib/plans'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BillingOverviewProps {
  agencyId: string
  plan: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  /** Whether the agency has a Stripe customer yet (drives portal button visibility). */
  hasStripeCustomer: boolean
  agentCount: number
  talentCount: number
  storageUsedBytes: number
  storageLimitBytes: number
  /** True if the agency already has legal_name + billing_address persisted in DB. */
  hasLegalData: boolean
  /** True if the agency already has dpa_accepted_at persisted in DB. */
  hasDpa: boolean
  /** Pre-filled legal data for the form (shown only when hasLegalData = false). */
  initialLegalData?: LegalEntityData
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null

  const colours: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trialing: 'bg-blue-100 text-blue-800',
    past_due: 'bg-amber-100 text-amber-800',
    canceled: 'bg-red-100 text-red-800',
    unpaid: 'bg-red-100 text-red-800',
  }
  const cls = colours[status] ?? 'bg-muted text-muted-foreground'

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Billing interval toggle
// ---------------------------------------------------------------------------

function IntervalToggle({
  interval,
  onChange,
}: {
  interval: BillingInterval
  onChange: (v: BillingInterval) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Billing interval"
      className="inline-flex rounded-md border border-input bg-muted p-1 gap-1"
    >
      {(['month', 'year'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={interval === v}
          onClick={() => onChange(v)}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
            interval === v
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {v === 'month' ? 'Monthly' : 'Annual'}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Plan upgrade card
// ---------------------------------------------------------------------------

function UpgradeCard({
  planId,
  interval,
  onUpgrade,
  disabled,
}: {
  planId: PlanId
  interval: BillingInterval
  onUpgrade: (planId: PlanId) => void
  disabled: boolean
}) {
  const planData = PLANS[planId]
  const isAnnual = interval === 'year'
  const pricePence = isAnnual ? planData.annualPricePence : planData.monthlyPricePence
  const pricePounds = pricePence / 100
  const priceLabel = isAnnual ? `£${pricePounds}/yr` : `£${pricePounds}/mo`
  const storageLabel = formatBytes(planData.storageLimitBytes)

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-5 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-base">{planData.displayName}</p>
          <p className="text-2xl font-bold mt-0.5">
            {priceLabel}
            {isAnnual && (
              <span className="ml-2 text-xs font-normal text-green-700 bg-green-100 rounded-full px-2 py-0.5">
                2 months free
              </span>
            )}
          </p>
        </div>
      </div>

      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>
          <span className="text-foreground font-medium">{planData.agentSeats}</span> agent seats
        </li>
        <li>Unlimited talent</li>
        <li>Unlimited free reviewers</li>
        <li>
          <span className="text-foreground font-medium">{storageLabel}</span> storage
        </li>
      </ul>

      <button
        type="button"
        onClick={() => onUpgrade(planId)}
        disabled={disabled}
        className="mt-auto inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        Upgrade to {planData.displayName}
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type UpgradeStep = 'idle' | 'legal' | 'dpa' | 'checkout'

export function BillingOverview({
  agencyId,
  plan,
  subscriptionStatus,
  currentPeriodEnd,
  hasStripeCustomer,
  agentCount,
  talentCount,
  storageUsedBytes,
  storageLimitBytes,
  hasLegalData,
  hasDpa,
  initialLegalData,
}: BillingOverviewProps) {
  const [upgradeStep, setUpgradeStep] = useState<UpgradeStep>('idle')
  const [targetPlan, setTargetPlan] = useState<string | null>(null)
  const [targetInterval, setTargetInterval] = useState<BillingInterval>('month')
  const [interval, setInterval] = useState<BillingInterval>('month')
  const [legalDataSaved, setLegalDataSaved] = useState(hasLegalData)
  const [dpaAccepted, setDpaAccepted] = useState(hasDpa)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const planData = getPlan(plan)
  const currentTierIndex = (PLAN_IDS as readonly string[]).indexOf(plan)
  const upgradablePlans = PLAN_IDS.slice(currentTierIndex + 1) as PlanId[]

  const renewalDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  // ---- Upgrade initiation ----
  function handleUpgradeClick(planKey: PlanId) {
    // Capture the chosen interval at click time — user may toggle during legal/DPA steps.
    setTargetPlan(planKey)
    setTargetInterval(interval)
    setErrorMessage(null)

    if (!legalDataSaved) {
      setUpgradeStep('legal')
    } else if (!dpaAccepted) {
      setUpgradeStep('dpa')
    } else {
      setUpgradeStep('checkout')
      void initiateCheckout(planKey, interval)
    }
  }

  function handleLegalSaved(data: LegalEntityData) {
    void data // acknowledged
    setLegalDataSaved(true)
    if (!dpaAccepted) {
      setUpgradeStep('dpa')
    } else if (targetPlan) {
      setUpgradeStep('checkout')
      void initiateCheckout(targetPlan, targetInterval)
    }
  }

  function handleDpaAccepted() {
    setDpaAccepted(true)
    if (targetPlan) {
      setUpgradeStep('checkout')
      void initiateCheckout(targetPlan, targetInterval)
    }
  }

  function handleDpaCancel() {
    setUpgradeStep('idle')
    setTargetPlan(null)
  }

  async function initiateCheckout(planKey: string, billingInterval: BillingInterval) {
    setIsRedirecting(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/agencies/${agencyId}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey, interval: billingInterval }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorMessage(body.error ?? 'Failed to start checkout. Please try again.')
        setUpgradeStep('idle')
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.location.href = url
    } catch {
      setErrorMessage('Network error — please try again.')
      setUpgradeStep('idle')
    } finally {
      setIsRedirecting(false)
    }
  }

  // ---- Billing portal ----
  async function handleManageSubscription() {
    setIsRedirecting(true)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agencyId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setErrorMessage(body.error ?? 'Failed to open billing portal. Please try again.')
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.location.href = url
    } catch {
      setErrorMessage('Network error — please try again.')
    } finally {
      setIsRedirecting(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* ---- Plan & subscription status ---- */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{planData.displayName}</h2>
            {subscriptionStatus && (
              <div className="mt-1">
                <StatusBadge status={subscriptionStatus} />
              </div>
            )}
          </div>

          {/* Manage subscription (existing Stripe customer) */}
          {hasStripeCustomer && (
            <button
              type="button"
              onClick={() => void handleManageSubscription()}
              disabled={isRedirecting}
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {isRedirecting ? 'Redirecting…' : 'Manage subscription'}
            </button>
          )}
        </div>

        {renewalDate && (
          <p className="text-sm text-muted-foreground">
            Next renewal: <span className="text-foreground font-medium">{renewalDate}</span>
          </p>
        )}

        {hasStripeCustomer && (
          <p className="text-sm text-muted-foreground">
            Payment method and invoices available in the billing portal.
          </p>
        )}
      </section>

      {/* ---- Usage ---- */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Usage</h3>
        <UsageBars
          plan={plan}
          agentCount={agentCount}
          talentCount={talentCount}
          storageUsedBytes={storageUsedBytes}
          storageLimitBytes={storageLimitBytes}
        />
      </section>

      {/* ---- Upgrade cards ---- */}
      {upgradablePlans.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Upgrade plan
            </h3>
            <IntervalToggle interval={interval} onChange={setInterval} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upgradablePlans.map((planKey) => (
              <UpgradeCard
                key={planKey}
                planId={planKey}
                interval={interval}
                onUpgrade={handleUpgradeClick}
                disabled={isRedirecting || upgradeStep !== 'idle'}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---- Error message ---- */}
      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {/* ---- Legal entity form (step 1 of upgrade flow) ---- */}
      {upgradeStep === 'legal' && (
        <section className="border rounded-lg p-6 space-y-4">
          <LegalEntityForm
            agencyId={agencyId}
            initialData={initialLegalData}
            onSaved={handleLegalSaved}
          />
          <div>
            <button
              type="button"
              onClick={() => {
                setUpgradeStep('idle')
                setTargetPlan(null)
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {/* ---- DPA modal (step 2 of upgrade flow) ---- */}
      {upgradeStep === 'dpa' && targetPlan && (
        <DpaAcceptanceModal
          agencyId={agencyId}
          onAccepted={handleDpaAccepted}
          onCancel={handleDpaCancel}
        />
      )}

      {/* ---- Checkout redirecting state ---- */}
      {upgradeStep === 'checkout' && (
        <p className="text-sm text-muted-foreground" role="status">
          Redirecting to checkout…
        </p>
      )}
    </div>
  )
}
