-- ============================================================
-- HUDO — PURGE EMPTY DRAFTS (space saver, spec D8)
-- 0026_purge_empty_drafts.sql
--
-- A video row with no video_versions is an abandoned draft (the upload never
-- completed). After 24h, purge it via purge_video (the single delete path), which
-- queues the {agency}/{video}/ prefix because a failed upload may have left parts.
-- Called by the daily storage-purge cron BEFORE it drains the queue.
-- ============================================================

CREATE OR REPLACE FUNCTION purge_empty_drafts(p_older_than interval DEFAULT interval '24 hours')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT v.id FROM videos v
     WHERE v.status = 'draft'
       AND v.active_version_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM video_versions vv WHERE vv.video_id = v.id)
       AND v.created_at < now() - p_older_than
  LOOP
    PERFORM purge_video(v_id, 'empty_draft', NULL, 'System');
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END
$$;

ALTER FUNCTION public.purge_empty_drafts(interval) OWNER TO postgres;
-- Supabase grants EXECUTE to anon/authenticated directly; PUBLIC alone is not enough (see 0015/0027).
REVOKE ALL ON FUNCTION public.purge_empty_drafts(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_empty_drafts(interval) TO service_role;
