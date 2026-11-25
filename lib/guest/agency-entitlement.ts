import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

/**
 * Guest links stop working when the agency's subscription has ENDED, and work again
 * if it resubscribes (computed live; link rows are never touched). S5-GUEST-003.
 *
 * Only `canceled` counts as ended. The DB CHECK allows just active|trialing|past_due|canceled,
 * and the Stripe webhook folds unpaid/incomplete/incomplete_expired/paused into `past_due`
 * (so those keep working, same as past_due: a product decision). A cancelled paid agency
 * ends as plan=freemium + status=canceled; a never-subscribed freemium agency holds 'active'.
 * Unknown or null values fail OPEN on purpose, so a status added later without updating
 * this code cannot kill every link at once; null is only a defensive branch.
 */
export function guestLinksAllowed(agency: { subscription_status: string | null }): boolean {
  return agency.subscription_status !== 'canceled'
}

/**
 * Looks up the agency behind a guest link and applies guestLinksAllowed.
 * Fails closed (false) on a lookup error or missing agency. Logs carry no token.
 */
export async function agencyAllowsGuestLinks(
  admin: SupabaseClient,
  agencyId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('agencies')
    .select('subscription_status')
    .eq('id', agencyId)
    .maybeSingle()
  if (error) {
    console.error('[guest:billing] Agency lookup failed:', error.message)
    Sentry.captureException(new Error(`guest agency lookup failed: ${error.message}`))
    return false
  }
  if (!data) return false
  return guestLinksAllowed(data)
}
