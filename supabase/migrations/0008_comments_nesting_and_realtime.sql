-- ============================================================
-- HUDO — COMMENTS NESTING DEPTH & REALTIME
-- 0008_comments_nesting_and_realtime.sql
--
-- Gap 1: Enforce max nesting depth of 1 (replies to top-level only).
-- Gap 3: Add comments to Supabase Realtime publication.
-- ============================================================

-- ── Nesting Depth Trigger ──────────────────────────────────────

CREATE OR REPLACE FUNCTION check_comment_nesting_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only check if parent_id is set (i.e., this is a reply)
  -- On UPDATE, skip if parent_id hasn't changed
  IF NEW.parent_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.parent_id IS DISTINCT FROM NEW.parent_id) THEN
    -- The parent must be a top-level comment (parent_id IS NULL)
    IF (SELECT parent_id FROM comments WHERE id = NEW.parent_id) IS NOT NULL THEN
      RAISE EXCEPTION 'Replies can only be made to top-level comments (max depth 1)'
        USING ERRCODE = '23514'; -- check_violation
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_comment_nesting_depth ON comments;
CREATE TRIGGER enforce_comment_nesting_depth
  BEFORE INSERT OR UPDATE ON comments
  FOR EACH ROW
  EXECUTE FUNCTION check_comment_nesting_depth();

-- ── Realtime Publication ───────────────────────────────────────
-- Add comments to the realtime publication so clients can subscribe
-- to comment changes scoped to a video_version_id.
-- Wrapped in DO block — realtime publication may not exist in CI.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.comments;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'supabase_realtime publication does not exist — skipping';
  WHEN duplicate_object THEN
    RAISE NOTICE 'comments already in supabase_realtime publication — skipping';
END;
$$;
