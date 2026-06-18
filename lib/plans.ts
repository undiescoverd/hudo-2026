/**
 * lib/plans.ts — THE single source of truth for Hudo plan/pricing tiers.
 *
 * Every other place that needs a tier number — the seat gate (lib/plan-gates.ts),
 * the storage cap written by the webhook (lib/billing.ts), the Stripe setup script,
 * the consistency guard, and the billing UI — derives from `PLANS` here.
 *
 * RULES (keep this file the only place tier numbers live):
 *   - No magic byte literals: storage is always `N * GiB`.
 *   - `talentLimit` is `null` on every tier — talent/roster is unlimited and never metered.
 *   - Guest reviewers (guest_links) are free + unlimited and are NOT a seat — not modelled here.
 *   - Prices are authored in pence (integer), matching Stripe `unit_amount`.
 *   - Annual = 10× monthly (two months free).
 *   - Freemium has NO Stripe price (lookup keys are null).
 *
 * This file has NO secrets and NO server-only imports → safe to import client-side
 * (e.g. the billing UI renders prices straight from PLANS).
 */

/** 1 GiB in bytes (binary/TiB convention — matches existing storage_limit_bytes values). */
export const GiB = 1024 ** 3

export type PlanId = 'freemium' | 'starter' | 'studio' | 'agency_pro'

export type BillingInterval = 'month' | 'year'

export interface Plan {
  id: PlanId
  displayName: string
  /** Max combined owner + admin_agent + agent seats. The primary paid lever. */
  agentSeats: number
  /** Talent seats. `null` = unlimited (talent is never metered). */
  talentLimit: null
  /** Storage cap in bytes — soft, generous secondary lever. Derived from GiB. */
  storageLimitBytes: number
  /** Monthly price in pence. 0 for freemium. */
  monthlyPricePence: number
  /** Annual price in pence (two months free). 0 for freemium. */
  annualPricePence: number
  /** Stripe lookup_key for the monthly recurring price. null for freemium. */
  stripeLookupKeyMonthly: string | null
  /** Stripe lookup_key for the annual recurring price. null for freemium. */
  stripeLookupKeyAnnual: string | null
}

/**
 * Canonical tier definitions. Authored numbers live ONLY here.
 *
 *   tier        monthly  annual   seats  talent      storage
 *   freemium    £0       £0       1      unlimited   10 GB
 *   starter     £15      £150     3      unlimited   100 GB
 *   studio      £39      £390     8      unlimited   500 GB
 *   agency_pro  £89      £890     20     unlimited   1 TB (1024 GiB)
 */
export const PLANS = {
  freemium: {
    id: 'freemium',
    displayName: 'Freemium',
    agentSeats: 1,
    talentLimit: null,
    storageLimitBytes: 10 * GiB,
    monthlyPricePence: 0,
    annualPricePence: 0,
    stripeLookupKeyMonthly: null,
    stripeLookupKeyAnnual: null,
  },
  starter: {
    id: 'starter',
    displayName: 'Starter',
    agentSeats: 3,
    talentLimit: null,
    storageLimitBytes: 100 * GiB,
    monthlyPricePence: 1500,
    annualPricePence: 15000,
    stripeLookupKeyMonthly: 'starter_monthly',
    stripeLookupKeyAnnual: 'starter_annual',
  },
  studio: {
    id: 'studio',
    displayName: 'Studio',
    agentSeats: 8,
    talentLimit: null,
    storageLimitBytes: 500 * GiB,
    monthlyPricePence: 3900,
    annualPricePence: 39000,
    stripeLookupKeyMonthly: 'studio_monthly',
    stripeLookupKeyAnnual: 'studio_annual',
  },
  agency_pro: {
    id: 'agency_pro',
    displayName: 'Agency Pro',
    agentSeats: 20,
    talentLimit: null,
    storageLimitBytes: 1024 * GiB,
    monthlyPricePence: 8900,
    annualPricePence: 89000,
    stripeLookupKeyMonthly: 'agency_pro_monthly',
    stripeLookupKeyAnnual: 'agency_pro_annual',
  },
} as const satisfies Record<PlanId, Plan>

/** All tier ids in upgrade order. */
export const PLAN_IDS = ['freemium', 'starter', 'studio', 'agency_pro'] as const

/** Paid tier ids (everything except freemium). */
export const PAID_PLAN_IDS = ['starter', 'studio', 'agency_pro'] as const

export type PaidPlanId = (typeof PAID_PLAN_IDS)[number]

/** Type guard: is this string a paid plan id? */
export function isPaidPlanId(plan: string): plan is PaidPlanId {
  return (PAID_PLAN_IDS as readonly string[]).includes(plan)
}

/** Look up a plan by id, falling back to freemium for unknown strings. */
export function getPlan(planId: string): Plan {
  return (PLANS as Record<string, Plan>)[planId] ?? PLANS.freemium
}

/**
 * lookup_key → PlanId reverse map.
 *
 * CRITICAL: built from BOTH the monthly AND annual lookup keys of every paid plan
 * (6 entries). The webhook resolves a subscription's price → plan via this map; if it
 * only covered monthly keys, every ANNUAL subscriber would silently downgrade to
 * freemium on their next subscription.updated event.
 */
export const LOOKUP_KEY_TO_PLAN: Readonly<Record<string, PlanId>> = (() => {
  const map: Record<string, PlanId> = {}
  for (const id of PAID_PLAN_IDS) {
    const plan = PLANS[id]
    if (plan.stripeLookupKeyMonthly) map[plan.stripeLookupKeyMonthly] = id
    if (plan.stripeLookupKeyAnnual) map[plan.stripeLookupKeyAnnual] = id
  }
  return map
})()

/** Resolve a Stripe lookup_key to a PlanId, or null if unknown. */
export function getPlanFromLookupKey(lookupKey: string | null | undefined): PlanId | null {
  if (!lookupKey) return null
  return LOOKUP_KEY_TO_PLAN[lookupKey] ?? null
}

/** The Stripe lookup_key for a paid plan + interval. */
export function getLookupKey(planId: PaidPlanId, interval: BillingInterval): string {
  const plan = PLANS[planId]
  const key = interval === 'year' ? plan.stripeLookupKeyAnnual : plan.stripeLookupKeyMonthly
  if (!key) throw new Error(`No Stripe lookup_key for plan "${planId}" interval "${interval}"`)
  return key
}

/** Storage cap in bytes for a plan id (freemium fallback for unknown strings). */
export function getStorageLimitBytes(planId: string): number {
  return getPlan(planId).storageLimitBytes
}

/** Agent-seat limit for a plan id (freemium fallback for unknown strings). */
export function getAgentSeatLimit(planId: string): number {
  return getPlan(planId).agentSeats
}
