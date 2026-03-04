-- ============================================================
-- HUDO — FIX COMMENTS SOFT-DELETE VIA SECURITY DEFINER
-- 0010_fix_comments_soft_delete.sql
--
-- Migration 0004 added `deleted_at IS NULL` to comments_select.
-- This prevents direct UPDATE of deleted_at because PostgreSQL
-- rejects new rows that would be invisible to SELECT policies.
--
-- Fix: SECURITY DEFINER function for soft-delete (same pattern
-- as get_current_user_agency_ids in migration 0003). Also
-- standardise UPDATE policies to use get_current_user_agency_ids().
-- ============================================================

-- 1. Re-create UPDATE policies using helper function
DROP POLICY IF EXISTS "comments_update_own" ON comments;
CREATE POLICY "comments_update_own" ON comments
  FOR UPDATE USING (
    user_id = auth.uid()
    AND agency_id = ANY(get_current_user_agency_ids())
  );

DROP POLICY IF EXISTS "comments_update_agents" ON comments;
CREATE POLICY "comments_update_agents" ON comments
  FOR UPDATE USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

-- 2. SECURITY DEFINER function for soft-delete
-- Bypasses RLS, manually enforces: own comment OR agent+ in same agency
CREATE OR REPLACE FUNCTION soft_delete_comment(p_comment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE comments
     SET deleted_at = now()
   WHERE id = p_comment_id
     AND deleted_at IS NULL
     AND (
       (user_id = auth.uid()
        AND agency_id = ANY(get_current_user_agency_ids()))
       OR
       agency_id IN (
         SELECT agency_id FROM memberships
         WHERE user_id = auth.uid()
           AND role IN ('owner', 'admin_agent', 'agent')
       )
     );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Comment not found or access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER FUNCTION soft_delete_comment(uuid) OWNER TO postgres;
