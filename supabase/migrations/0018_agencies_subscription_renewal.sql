-- Migration: 0018_agencies_subscription_renewal
--
-- Adds current_period_end to the agencies table so billing sync can record
-- the Stripe subscription's current billing period end date.
--
-- current_period_end is populated by handleSubscriptionUpdated (covers both
-- customer.subscription.created and customer.subscription.updated events)
-- from subscription.items.data[0].current_period_end (UNIX seconds →
-- timestamptz). The checkout.session.completed handler does not write it
-- directly; the subsequent subscription.created event does.

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;
