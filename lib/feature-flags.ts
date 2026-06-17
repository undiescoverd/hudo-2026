/**
 * Feature flags — all gated features live here.
 *
 * Server + client safe: all flags use NEXT_PUBLIC_ so they're available
 * in both Server Components and client components without separate server reads.
 *
 * To enable billing: set NEXT_PUBLIC_BILLING_ENABLED=true in your env.
 */

export function isBillingEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true'
}
