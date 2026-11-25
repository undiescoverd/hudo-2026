/**
 * /settings/billing — Billing overview page.
 *
 * Server component: owner, or an admin agent the owner granted billing access to
 * (memberships.can_manage_billing); behind the billing feature flag. A granted admin
 * agent sees plan, usage and the payment-method portal but no upgrade controls
 * (plan change and cancel stay owner-only).
 * Loads agency plan/usage data and passes it to the BillingOverview client component.
 */

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { isBillingEnabled } from '@/lib/feature-flags'
import { AGENT_SEAT_ROLES } from '@/lib/plan-gates'
import { BillingOverview } from '@/components/billing/BillingOverview'
import { createAdminClient } from '@/lib/supabase-admin'
import { canChangePlan, pickBillingMembership } from '@/lib/billing-access'

export default async function BillingSettingsPage() {
  if (!isBillingEnabled()) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Billing</h1>
        </div>
        <p className="text-sm text-muted-foreground">Billing is not available yet.</p>
      </div>
    )
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Misconfiguration — fail loudly rather than letting createClient(url, undefined)
    // produce opaque auth errors on every query.
    throw new Error('[settings/billing] Missing Supabase environment variables')
  }

  const supabase = await createSupabaseServerClient(supabaseUrl, supabaseAnonKey)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/signin')
  }

  // Use service-role client to bypass RLS for membership + agency reads
  const admin = createAdminClient()

  // Resolve the agency the user may see billing for: owner, or admin agent with the
  // grant. Order deterministically so a multi-agency user always lands on the same
  // agency (the portal route is scoped by this agencyId). Read fresh every request.
  const { data: candidateRows } = await admin
    .from('memberships')
    .select('agency_id, role, can_manage_billing')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin_agent'])
    .order('created_at', { ascending: true })

  const billingMembership = pickBillingMembership(candidateRows ?? [])

  if (!billingMembership) {
    redirect('/settings/notifications')
  }

  const agencyId = billingMembership.agency_id
  const mayChangePlan = canChangePlan(billingMembership)

  // Load the agency row
  const { data: agency } = await admin
    .from('agencies')
    .select(
      'plan, subscription_status, current_period_end, storage_usage_bytes, storage_limit_bytes, stripe_customer_id, legal_name, billing_address, vat_number, dpa_accepted_at'
    )
    .eq('id', agencyId)
    .single()

  if (!agency) {
    redirect('/dashboard')
  }

  // Count agent seats (owner + admin_agent + agent roles)
  const { count: agentCount } = await admin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .in('role', [...AGENT_SEAT_ROLES])

  // Count talent seats
  const { count: talentCount } = await admin
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('agency_id', agencyId)
    .eq('role', 'talent')

  const typedAgency = agency as {
    plan: string
    subscription_status: string | null
    current_period_end: string | null
    storage_usage_bytes: number
    storage_limit_bytes: number
    stripe_customer_id: string | null
    legal_name: string | null
    billing_address: Record<string, unknown> | null
    vat_number: string | null
    dpa_accepted_at: string | null
  }

  // Mirror LegalEntityForm's isAddressFilled + the PATCH validator: a saved
  // address requires line1, city, postal_code (a partial/empty object is "not yet filled").
  const addr = typedAgency.billing_address
  const hasAddress =
    !!addr &&
    typeof addr === 'object' &&
    (['line1', 'city', 'postal_code'] as const).every(
      (f) => typeof addr[f] === 'string' && (addr[f] as string).trim() !== ''
    )
  const hasLegalData =
    !!typedAgency.legal_name && typedAgency.legal_name.trim() !== '' && hasAddress

  const hasDpa = !!typedAgency.dpa_accepted_at

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {mayChangePlan
            ? 'Manage your plan, usage, and billing details.'
            : 'View your plan, usage and invoices, and update the payment method.'}
        </p>
      </div>

      <BillingOverview
        agencyId={agencyId}
        canChangePlan={mayChangePlan}
        plan={typedAgency.plan ?? 'freemium'}
        subscriptionStatus={typedAgency.subscription_status}
        currentPeriodEnd={typedAgency.current_period_end}
        hasStripeCustomer={!!typedAgency.stripe_customer_id}
        agentCount={agentCount ?? 0}
        talentCount={talentCount ?? 0}
        storageUsedBytes={typedAgency.storage_usage_bytes ?? 0}
        storageLimitBytes={typedAgency.storage_limit_bytes ?? 5_368_709_120}
        hasLegalData={hasLegalData}
        hasDpa={hasDpa}
        initialLegalData={
          hasLegalData
            ? undefined
            : {
                legal_name: typedAgency.legal_name ?? '',
                billing_address: typedAgency.billing_address as {
                  line1: string
                  line2?: string
                  city: string
                  postal_code: string
                  country: string
                } | null,
                vat_number: typedAgency.vat_number ?? undefined,
              }
        }
      />
    </div>
  )
}
