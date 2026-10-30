-- ============================================================
-- HUDO — PURGE FUNCTIONS (the single delete path, spec D7)
-- 0025_purge_functions.sql
--
-- Each function is ONE transaction: queue the R2 keys/prefix in
-- storage_deletions, lower agencies.storage_usage_bytes (floored at 0),
-- write an audit_log row, then delete the rows (FKs cascade; see 0024).
-- Server code calls these ONLY via createAdminClient() (service_role).
--
-- Comments are hard-deleted here and nowhere else: a version/video purge
-- cascades to them. comments.parent_id is NO ACTION, but the cascade is a
-- single DELETE statement removing parent and reply together, and NO ACTION
-- is checked at statement end, so it is never violated. A reply on a different
-- version than its parent holds too: a video purge deletes all versions in one statement.
-- ============================================================

CREATE OR REPLACE FUNCTION purge_video(
  p_video_id   uuid,
  p_reason     text,
  p_actor_id   uuid,
  p_actor_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_agency uuid;
  v_bytes  bigint;
BEGIN
  SELECT agency_id INTO v_agency FROM videos WHERE id = p_video_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;  -- idempotent

  SELECT COALESCE(SUM(file_size_bytes), 0) INTO v_bytes
    FROM video_versions WHERE video_id = p_video_id;

  INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
    VALUES (v_agency, v_agency || '/' || p_video_id || '/', true, v_bytes, p_reason);

  UPDATE agencies
     SET storage_usage_bytes = GREATEST(storage_usage_bytes - v_bytes, 0)
   WHERE id = v_agency;

  INSERT INTO audit_log (agency_id, actor_id, actor_name, action, resource_type, resource_id, metadata)
    VALUES (v_agency, p_actor_id, p_actor_name, 'video_purged', 'video', p_video_id,
            jsonb_build_object('reason', p_reason, 'bytes', v_bytes));

  -- Cascades versions, comments, guest_links, comment_reads, notifications.
  -- videos.active_version_id is ON DELETE SET NULL, so the cycle needs no manual break.
  DELETE FROM videos WHERE id = p_video_id;
  RETURN v_bytes;
END
$$;

CREATE OR REPLACE FUNCTION purge_video_version(
  p_version_id uuid,
  p_reason     text,
  p_actor_id   uuid,
  p_actor_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_video  uuid;
  v_agency uuid;
  v_key    text;
  v_bytes  bigint;
  v_queue  boolean;
  v_why    text;
BEGIN
  -- Lock order matches purge_video (video first, then version) so the two cannot deadlock,
  -- and the active-version check below cannot race a concurrent "make this version active".
  SELECT video_id INTO v_video FROM video_versions WHERE id = p_version_id;
  IF NOT FOUND THEN RETURN 0; END IF;  -- idempotent
  PERFORM 1 FROM videos WHERE id = v_video FOR UPDATE;

  SELECT agency_id, r2_key, file_size_bytes
    INTO v_agency, v_key, v_bytes
    FROM video_versions WHERE id = p_version_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;  -- purged while we waited for the lock

  IF EXISTS (SELECT 1 FROM videos WHERE id = v_video AND active_version_id = p_version_id) THEN
    RAISE EXCEPTION 'Cannot delete the current version; delete the video or upload a new version'
      USING ERRCODE = 'P0409';
  END IF;

  -- Only queue a key that is provably this version's alone: inside its own video prefix and
  -- not shared with another version (upload/complete replays) or the thumbnail.
  v_queue := true;
  IF left(v_key, length(v_agency::text) + length(v_video::text) + 2) <> v_agency || '/' || v_video || '/' THEN
    v_queue := false; v_why := 'key outside video prefix';
  ELSIF EXISTS (SELECT 1 FROM video_versions WHERE r2_key = v_key AND id <> p_version_id)
     OR EXISTS (SELECT 1 FROM videos WHERE thumbnail_r2_key = v_key) THEN
    v_queue := false; v_why := 'key shared with another version or thumbnail';
  END IF;

  IF v_queue THEN
    INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
      VALUES (v_agency, v_key, false, v_bytes, p_reason);
  END IF;

  UPDATE agencies
     SET storage_usage_bytes = GREATEST(storage_usage_bytes - v_bytes, 0)
   WHERE id = v_agency;

  INSERT INTO audit_log (agency_id, actor_id, actor_name, action, resource_type, resource_id, metadata)
    VALUES (v_agency, p_actor_id, p_actor_name, 'version_purged', 'video', v_video,
            jsonb_build_object('reason', p_reason, 'bytes', v_bytes, 'version_id', p_version_id,
                               'key_queued', v_queue)
            || CASE WHEN v_queue THEN '{}'::jsonb ELSE jsonb_build_object('key_skipped_reason', v_why) END);

  DELETE FROM video_versions WHERE id = p_version_id;  -- cascades comments (incl. replies), guest_links
  RETURN v_bytes;
END
$$;

CREATE OR REPLACE FUNCTION purge_talent_in_agency(
  p_talent_id  uuid,
  p_agency_id  uuid,
  p_actor_id   uuid,
  p_actor_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id    uuid;
  v_total bigint := 0;
BEGIN
  FOR v_id IN SELECT id FROM videos WHERE talent_id = p_talent_id AND agency_id = p_agency_id LOOP
    v_total := v_total + purge_video(v_id, 'talent_erased', p_actor_id, p_actor_name);
  END LOOP;
  RETURN v_total;
END
$$;

CREATE OR REPLACE FUNCTION purge_agency(p_agency_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bytes bigint;
BEGIN
  SELECT storage_usage_bytes INTO v_bytes FROM agencies WHERE id = p_agency_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;  -- idempotent

  INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
    VALUES (p_agency_id, p_agency_id || '/', true, COALESCE(v_bytes, 0), 'agency_closed');

  -- Cascades everything incl. audit_log (documented exception to insert-only, D14).
  DELETE FROM agencies WHERE id = p_agency_id;
  RETURN COALESCE(v_bytes, 0);
END
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'purge_video(uuid,text,uuid,text)',
    'purge_video_version(uuid,text,uuid,text)',
    'purge_talent_in_agency(uuid,uuid,uuid,text)',
    'purge_agency(uuid)'
  ] LOOP
    EXECUTE format('ALTER FUNCTION public.%s OWNER TO postgres', f);
    -- Supabase grants EXECUTE to anon/authenticated directly; PUBLIC alone is not enough (see 0015/0027).
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END
$$;
