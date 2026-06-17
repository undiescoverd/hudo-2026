-- Migration: add is_founding_member to agencies
-- Beta agencies created via scripts/create-beta-agency.mjs get this set to true.
-- Used by the Stripe checkout handler to apply the FOUNDING_50 coupon (50% off, 12 months).

ALTER TABLE agencies
  ADD COLUMN IF NOT EXISTS is_founding_member boolean NOT NULL DEFAULT false;
