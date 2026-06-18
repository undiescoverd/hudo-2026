-- Migration: 0019_agencies_grace_period
--
-- Adds grace_period_ends_at to the agencies table so the billing sync can
-- record when a past_due agency's grace window expires.
--
-- Populated by handleInvoicePaymentFailed (invoice.payment_failed event):
--   grace_period_ends_at = event timestamp + 7 days
-- Cleared (set to NULL) by handleCheckoutSessionCompleted and
-- handleSubscriptionUpdated when the subscription status transitions to
-- active or trialing.
--
-- Used by isGracePeriodExpired() in lib/plan-gates.ts to gate upload and
-- invite endpoints: past_due + now > grace_period_ends_at → 402.

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;
