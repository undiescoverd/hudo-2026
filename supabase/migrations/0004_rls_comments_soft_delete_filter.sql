-- ============================================================
-- HUDO — RLS COMMENTS SOFT-DELETE FILTER
-- 0004_rls_comments_soft_delete_filter.sql
--
-- P1-006: The comments_select policy must exclude soft-deleted
-- comments (deleted_at IS NOT NULL) to prevent clients from
-- reading comments that have been soft-deleted.
-- ============================================================

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
    AND deleted_at IS NULL
  );
