-- ============================================================
-- HUDO — RLS FIX: Break memberships_select infinite recursion
-- 0003_rls_fix_memberships_recursion.sql
-- Run against: Supabase dev, staging, and production
-- ============================================================
-- Problem: The `memberships_select` policy in 0002 queries `memberships`
-- within its own USING clause, causing infinite recursion when any
-- authenticated client queries a table whose policy references memberships
-- (i.e., virtually every table).
--
--   Recursive chain:
--     SELECT FROM agencies
--       → agency_select USING: SELECT agency_id FROM memberships
--         → memberships_select USING: SELECT agency_id FROM memberships ← RECURSION
--
-- Fix: Introduce a SECURITY DEFINER function that retrieves the current
-- user's agency IDs from memberships without triggering RLS on memberships.
-- Update memberships_select to use this function, breaking the cycle.
--
-- This function is also used in other policies for clarity and performance.
-- ============================================================

-- ── Helper: get the authenticated user's agency IDs ──────────────────
-- SECURITY DEFINER allows the function to bypass RLS on memberships
-- when resolving the current user's own memberships. This is safe
-- because the function always filters by auth.uid() — a user can only
-- ever see their own memberships through this function.

CREATE OR REPLACE FUNCTION get_current_user_agency_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY_AGG(agency_id)
  FROM memberships
  WHERE user_id = auth.uid()
$$;

-- ── Fix memberships_select — replace self-referential subquery ────────
-- Old (recursive): SELECT agency_id FROM memberships WHERE user_id = auth.uid()
-- New (uses SECURITY DEFINER function — no recursion):

DROP POLICY IF EXISTS "memberships_select" ON memberships;
CREATE POLICY "memberships_select" ON memberships
  FOR SELECT USING (
    agency_id = ANY(get_current_user_agency_ids())
  );

-- ============================================================
-- All other policies in 0002 reference memberships via subquery
-- (e.g., agency_select, videos_select_agents, etc.) — these do NOT
-- cause recursion now that memberships_select itself is non-recursive.
-- They continue to work correctly as-is.
-- ============================================================
