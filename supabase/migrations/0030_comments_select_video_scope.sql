-- ============================================================
-- HUDO — comments_select FOLLOWS VIDEO VISIBILITY; NO UN-DELETE
-- 0030_comments_select_video_scope.sql
--
-- Follow-up to the #196 audit (migration 0029 / GitHub #187).
--
-- Why: 0002 (restored by 0029) scopes comments_select by agency only.
-- Talent can only see their own videos (videos_select_talent) and those
-- videos' versions (video_versions_select); this aligns comments_select
-- with the same ownership rule.
--
-- comments_select, two branches:
--   1. Agents and above (owner, admin_agent, agent): every comment in
--      any agency where they hold one of those roles. Unchanged for
--      them.
--   2. Any other member (talent): only comments on versions of videos
--      where videos.talent_id = auth.uid(), within their agencies.
--
-- No `deleted_at IS NULL` filter, on purpose (#187, option b): a soft
-- delete is an UPDATE, and Realtime checks each subscriber's SELECT
-- policy against the NEW row, so a filter would stop other viewers
-- receiving the soft-delete event. Soft-deleted comments therefore
-- stay visible to exactly those who can see the video; app code still
-- filters deleted_at on every read.
--
-- Recursion safety: the memberships subquery goes through
-- memberships_select, which is non-recursive since 0003. The
-- video_versions / videos subquery is subject to their own RLS, but
-- neither policy references comments, so there is no cycle. The join
-- is the explicit `v.id = vv.video_id`; the two-FK videos<->video_versions
-- ambiguity only affects unhinted PostgREST embeds, not SQL joins.
--
-- prevent_comment_undelete (BEFORE UPDATE trigger): once a comment is
-- soft-deleted it stays deleted. Soft-deleted rows stay readable (#187)
-- and comments_update_own / comments_update_agents have no column
-- restriction, so without this a direct client write could set
-- `deleted_at` back to NULL. No API route un-deletes: soft_delete_comment
-- (0010) and app/api/comments/[id]/route.ts PATCH/DELETE all filter
-- `deleted_at IS NULL`, so they never trip this trigger. The function
-- is NOT SECURITY DEFINER (it only reads OLD/NEW) and fires for every
-- role, service_role and superuser included. It is a plain BEFORE
-- UPDATE (not UPDATE OF deleted_at), so a value set by another trigger
-- is still caught.
--
-- Idempotent: DROP IF EXISTS + CREATE for the policy and the trigger,
-- CREATE OR REPLACE for the function.
-- ============================================================

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    -- Agents and above: every comment in agencies where they hold an agent+ role
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
    OR (
      -- Talent (any member): only comments on videos they own
      agency_id = ANY(get_current_user_agency_ids())
      AND video_version_id IN (
        SELECT vv.id
        FROM video_versions vv
        JOIN videos v ON v.id = vv.video_id
        WHERE v.talent_id = auth.uid()
      )
    )
  );

CREATE OR REPLACE FUNCTION public.prevent_comment_undelete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    RAISE EXCEPTION 'Soft-deleted comments cannot be restored'
      USING ERRCODE = '23514'; -- check_violation
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_comment_undelete ON comments;
CREATE TRIGGER prevent_comment_undelete
  BEFORE UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION prevent_comment_undelete();
