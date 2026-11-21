-- ============================================================
-- HUDO — PURGE EMPTY DRAFTS (space saver, spec D8)
-- 0026_purge_empty_drafts.sql
--
-- A video row with no video_versions is an abandoned draft (the upload never
-- completed). After 24h, purge it via purge_video (the single delete path), which
-- queues the {agency}/{video}/ prefix because a failed upload may have left parts.
-- Called by the daily storage-purge cron BEFORE it drains the queue.
-- ============================================================

-- Limitations / design notes:
--  * created_at is the age clock. An old draft that is re-presigned for a retry can be swept
--    immediately: a still-in-flight upload on a draft older than 24h can be lost (upload/complete
--    then returns 404). Accepted; a completed upload can no longer be lost (see the recheck below).
--  * Bounded: at most 500 drafts per run (oldest first); the rest go in the next daily run.
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
     ORDER BY v.created_at
     LIMIT 500
  LOOP
    BEGIN
      -- The candidate list above is an unlocked snapshot. upload/complete (create_video_version)
      -- locks the video row and may commit a version after the snapshot; purge_video would then
      -- delete that brand-new version and queue its R2 prefix. So re-lock and re-test each row:
      -- FOR UPDATE blocks/serialises against create_video_version, SKIP LOCKED skips a row being
      -- written right now (retry tomorrow), and the re-test catches versions committed since.
      PERFORM 1 FROM videos v
        WHERE v.id = v_id AND v.status = 'draft' AND v.active_version_id IS NULL
          AND v.created_at < now() - p_older_than
          AND NOT EXISTS (SELECT 1 FROM video_versions vv WHERE vv.video_id = v.id)
        FOR UPDATE SKIP LOCKED;
      IF FOUND THEN
        PERFORM purge_video(v_id, 'empty_draft', NULL, 'System');
        v_count := v_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad row must not roll back the whole sweep (the subtransaction undoes only this row).
      RAISE WARNING 'purge_empty_drafts: skipped video %: %', v_id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END
$$;

ALTER FUNCTION public.purge_empty_drafts(interval) OWNER TO postgres;
-- Supabase grants EXECUTE to anon/authenticated directly; PUBLIC alone is not enough (see 0015/0027).
REVOKE ALL ON FUNCTION public.purge_empty_drafts(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_empty_drafts(interval) TO service_role;
