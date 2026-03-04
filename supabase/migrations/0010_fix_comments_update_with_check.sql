-- ============================================================
-- HUDO — FIX COMMENTS UPDATE POLICIES WITH CHECK
-- 0010_fix_comments_update_with_check.sql
--
-- After migration 0004 added deleted_at IS NULL to the SELECT
-- policy, the UPDATE policies need explicit WITH CHECK clauses
-- to allow setting deleted_at (soft-delete). Without explicit
-- WITH CHECK, PostgreSQL may use the SELECT policy's conditions
-- when evaluating new row validity.
-- ============================================================

-- Re-create comments_update_own with explicit WITH CHECK
DROP POLICY IF EXISTS "comments_update_own" ON comments;
CREATE POLICY "comments_update_own" ON comments
  FOR UPDATE USING (
    user_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- Re-create comments_update_agents with explicit WITH CHECK
DROP POLICY IF EXISTS "comments_update_agents" ON comments;
CREATE POLICY "comments_update_agents" ON comments
  FOR UPDATE USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  )
  WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );
