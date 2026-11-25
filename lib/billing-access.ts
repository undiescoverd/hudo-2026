/**
 * Billing access rule (S5-ADMIN-001, GH #207).
 *
 * Billing is owner-only by default. An owner may grant billing access to an
 * individual admin_agent (`memberships.can_manage_billing`). Explicit role
 * checks only — never `roleAtLeast`, which fails open for unknown roles.
 *
 *   owner                      -> 'owner'    view, change payment method, change plan, cancel
 *   admin_agent + granted flag -> 'delegate' view plan/invoices, change payment method
 *   everyone else              -> null       no access
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export type BillingMembership = { role: string; can_manage_billing?: boolean | null }
export type BillingAccess = 'owner' | 'delegate' | null

export function getBillingAccess(m: BillingMembership | null | undefined): BillingAccess {
  if (!m) return null
  if (m.role === 'owner') return 'owner'
  if (m.role === 'admin_agent' && m.can_manage_billing === true) return 'delegate'
  return null
}

/** View the plan and invoices, open the payment-method portal. */
export function canViewBilling(m: BillingMembership | null | undefined): boolean {
  return getBillingAccess(m) !== null
}

/** Change plan, cancel, edit legal entity / DPA: owner only. */
export function canChangePlan(m: BillingMembership | null | undefined): boolean {
  return getBillingAccess(m) === 'owner'
}

/** Only an owner may grant or revoke billing access. */
export function canGrantBillingAccess(callerRole: string): boolean {
  return callerRole === 'owner'
}

/** Billing access can be offered to admin agents only. */
export function isBillingGrantTarget(targetRole: string): boolean {
  return targetRole === 'admin_agent'
}

/**
 * Loads the caller's membership fresh from the DB (no caching, so a revoke
 * takes effect on the next request) and requires billing access.
 * `ownerOnly` additionally rejects delegates. DB error -> 500, no access -> 403.
 */
export async function requireBillingAccess(
  admin: SupabaseClient,
  userId: string,
  agencyId: string,
  opts: { ownerOnly?: boolean } = {}
): Promise<{ role: string; access: Exclude<BillingAccess, null> } | NextResponse> {
  const { data, error } = await admin
    .from('memberships')
    .select('role, can_manage_billing')
    .eq('user_id', userId)
    .eq('agency_id', agencyId)
    .maybeSingle()

  if (error) {
    console.error('[billing-access] Membership lookup failed:', error.message)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }

  const access = getBillingAccess(data as BillingMembership | null)
  if (!access || (opts.ownerOnly && access !== 'owner')) {
    return NextResponse.json(
      {
        error: opts.ownerOnly
          ? 'Access denied — owner role required'
          : 'Access denied — billing access required',
      },
      { status: 403 }
    )
  }
  return { role: (data as BillingMembership).role, access }
}

/**
 * Which membership the billing page should show: an owner membership first (full
 * control), then a granted admin agent one. Input order (created_at) breaks ties.
 */
export function pickBillingMembership<T extends BillingMembership>(candidates: T[]): T | undefined {
  return (
    candidates.find((m) => getBillingAccess(m) === 'owner') ??
    candidates.find((m) => getBillingAccess(m) === 'delegate')
  )
}

/**
 * Billing access across ALL of a user's memberships (header + settings nav).
 * `hasAccess`: owner anywhere, or a granted admin agent anywhere.
 * `isDelegate`: holds a granted admin_agent membership (feeds settingsNavItems).
 * Read per request with the caller's own client; no caching.
 */
export async function getUserBillingAccess(
  supabase: SupabaseClient,
  userId: string
): Promise<{ hasAccess: boolean; isDelegate: boolean }> {
  const { data, error } = await supabase
    .from('memberships')
    .select('role, can_manage_billing')
    .eq('user_id', userId)
  if (error)
    console.error('[billing-access] getUserBillingAccess failed (fail closed):', error.message)
  const levels = ((data ?? []) as BillingMembership[]).map(getBillingAccess)
  return { hasAccess: levels.some((l) => l !== null), isDelegate: levels.includes('delegate') }
}
