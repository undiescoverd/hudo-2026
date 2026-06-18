'use client'

/**
 * BillingOverview — displays plan status, usage, and upgrade/portal actions.
 *
 * Upgrade flow:
 *   1. Click "Upgrade to <plan>" button.
 *   2. If legal entity data is incomplete, show LegalEntityForm (PATCH /api/agencies/[id]/billing).
 *   3. Once legal data is saved, show DpaAcceptanceModal (POST /api/agencies/[id]/dpa-accept).
 *   4. Once DPA is accepted, POST /api/agencies/[id]/billing { plan } → redirect to { url }.
 *
 * The server re-validates all preconditions on POST regardless of UI state,
 * so the UI just needs to surface the steps to the user.
 */

import { useState } from 'react'
import { UsageBars } from '@/components/billing/UsageBars'
import { LegalEntityForm, type LegalEntityData } from '@/components/billing/LegalEntityForm'
import { DpaAcceptanceModal } from '@/components/billing/DpaAcceptanceModal'

// ---------------------------------------------------------------------------
// Plan tier ordering — must match keys in PLAN_LIMITS / PAID_PLANS
// ---------------------------------------------------------------------------

const PLAN_TIERS: ReadonlyArray<string> = ['freemium', 'starter', 'studio', 'agency_pro']

const PLAN_DISPLAY_NAMES: Record<string, string> = {
  freemium: 'Freemium',
  starter: 'Starter',
  studio: 'Studio',
  agency_pro: 'Agency Pro',
}

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
  const [legalDataSaved, setLegalDataSaved] = useState(hasLegalData)
  const [dpaAccepted, setDpaAccepted] = useState(hasDpa)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const planDisplayName = PLAN_DISPLAY_NAMES[plan] ?? plan
  const currentTierIndex = PLAN_TIERS.indexOf(plan)
  const upgradablePlans = PLAN_TIERS.slice(currentTierIndex + 1)

  const renewalDate = currentPeriodEnd
    ? new Date(currentPeriodEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  // ---- Upgrade initiation ----
  function handleUpgradeClick(planKey: string) {
    setTargetPlan(planKey)
    setErrorMessage(null)

    if (!legalDataSaved) {
      setUpgradeStep('legal')
    } else if (!dpaAccepted) {
      setUpgradeStep('dpa')
    } else {
      setUpgradeStep('checkout')
      void initiateCheckout(planKey)
    }
  }

  function handleLegalSaved(data: LegalEntityData) {
    void data // acknowledged
    setLegalDataSaved(true)
    if (!dpaAccepted) {
      setUpgradeStep('dpa')
    } else if (targetPlan) {
      setUpgradeStep('checkout')
      void initiateCheckout(targetPlan)
    }
  }

  function handleDpaAccepted() {
    setDpaAccepted(true)
    if (targetPlan) {
      setUpgradeStep('checkout')
      void initiateCheckout(targetPlan)
    }
  }

  function handleDpaCancel() {
    setUpgradeStep('idle')
    setTargetPlan(null)
  }

  async function initiateCheckout(planKey: string) {
    setIsRedirecting(true)
    setErrorMessage(null)
    try {
      const res = await fetch(`/api/agencies/${agencyId}/billing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
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
            <h2 className="text-lg font-semibold">{planDisplayName}</h2>
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

      {/* ---- Upgrade buttons ---- */}
      {upgradablePlans.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            Upgrade plan
          </h3>
          <div className="flex flex-wrap gap-3">
            {upgradablePlans.map((planKey) => (
              <button
                key={planKey}
                type="button"
                onClick={() => handleUpgradeClick(planKey)}
                disabled={isRedirecting || upgradeStep !== 'idle'}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
              >
                Upgrade to {PLAN_DISPLAY_NAMES[planKey] ?? planKey}
              </button>
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
