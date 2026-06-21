-- 0021_plan_storage_backfill.sql
--
-- Idempotent / safe to re-run: ALTER COLUMN is idempotent once the default is set;
-- the UPDATE is a full-table scan that overwrites every row to the canonical value.
--
-- The agency_pro reduction (2 TB → 1 TiB, i.e. 1099511627776 bytes) is DELIBERATE.
-- Existing over-limit agencies are NOT evicted: the cap only blocks NEW uploads once
-- storage_used_bytes approaches the new limit.
--
-- Plan CHECK constraint is UNCHANGED — plan ids (freemium, starter, studio, agency_pro)
-- are unaffected.
--
-- No talent-cap column exists in this table — talent is unlimited and not modelled here.

-- 1. Update the column default to match the freemium tier in lib/plans.ts (10 GiB).
--    Previous default was 5368709120 (5 GiB, stale).
ALTER TABLE agencies
  ALTER COLUMN storage_limit_bytes SET DEFAULT 10737418240;

-- 2. Back-fill every existing agency to the canonical per-plan storage cap.
--    NOTE: this UPDATE is intentionally WHERE-less. As of this migration NO agency carries
--    a custom/bespoke storage_limit_bytes override (storage is purely tier-driven), so
--    overwriting every row to the canonical per-plan value is safe and idempotent. If
--    per-agency custom caps ever become a feature, add a WHERE guard before re-running.
--    Byte values below are N * GiB (GiB = 1024^3) and MUST equal lib/plans.ts exactly:
--      freemium   10 GiB  = 10737418240
--      starter   100 GiB  = 107374182400
--      studio    500 GiB  = 536870912000
--      agency_pro 1024 GiB (1 TiB) = 1099511627776
UPDATE agencies
SET storage_limit_bytes = CASE plan
  WHEN 'freemium'   THEN  10737418240
  WHEN 'starter'    THEN 107374182400
  WHEN 'studio'     THEN 536870912000
  WHEN 'agency_pro' THEN 1099511627776
  ELSE                    10737418240  -- unknown plan → freemium cap
END;
