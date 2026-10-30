-- ============================================================
-- HUDO — comments_select KEEPS SOFT-DELETED ROWS VISIBLE
-- 0029_comments_select_keep_soft_deleted.sql
--
-- Aligns the repo with live. Migration 0004 added `deleted_at IS NULL`
-- to comments_select, but 0004 was never applied to hudo-dev or
-- hudo-staging (it is recorded as applied, so `db push` never runs it).
-- Live therefore still has the 0002 policy, while CI's pgTAP job applies
-- every file in order and so tests against the 0004 filter.
--
-- Decision (GitHub #187, option b): keep the live behaviour. A soft
-- delete is an UPDATE that sets deleted_at, and Supabase Realtime checks
-- each subscriber's SELECT policy against the NEW row. With the filter,
-- other viewers would never receive the soft-delete event and the
-- comment would linger in their thread until a refetch.
--
-- This forward migration recreates comments_select with the exact 0002
-- USING clause (deliberately NOT refactored to
-- get_current_user_agency_ids(); the goal is to match live).
--
-- The API already excludes soft-deleted comments in app code
-- (`.is('deleted_at', null)` on every read route), so the UI never
-- shows them.
--
-- Accepted trade-off: a soft-deleted comment's text stays readable to
-- members of its own agency through direct supabase-js reads and the
-- Realtime payload. Cross-agency isolation is unchanged.
--
-- Idempotent on live: DROP IF EXISTS + CREATE yields the same policy
-- live already has. On a fresh database it replaces the 0004 version.
-- ============================================================

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );
