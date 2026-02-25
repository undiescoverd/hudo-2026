-- ============================================================
-- HUDO — RPC CALLER VALIDATION
-- 0006_rpc_caller_validation.sql
--
-- RES-174: Add caller validation to create_video_version RPC.
-- The function is SECURITY DEFINER, so it bypasses RLS. Without
-- this check, any authenticated user could create video versions
-- attributed to another user by passing a different p_uploaded_by.
-- ============================================================

CREATE OR REPLACE FUNCTION create_video_version(
  p_video_id        uuid,
  p_agency_id       uuid,
  p_r2_key          text,
  p_file_size_bytes bigint,
  p_uploaded_by     uuid
)
RETURNS video_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version integer;
  v_new_version  video_versions;
BEGIN
  -- RES-174: Validate caller identity — p_uploaded_by must match the authenticated user.
  -- This prevents privilege escalation via SECURITY DEFINER bypass.
  IF p_uploaded_by != auth.uid() THEN
    RAISE EXCEPTION 'p_uploaded_by must match the authenticated user'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Lock the video row to prevent concurrent version number increments
  PERFORM id FROM videos WHERE id = p_video_id FOR UPDATE;

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM video_versions
   WHERE video_id = p_video_id;

  -- Insert the new version
  INSERT INTO video_versions (
    video_id,
    agency_id,
    version_number,
    r2_key,
    file_size_bytes,
    uploaded_by
  )
  VALUES (
    p_video_id,
    p_agency_id,
    v_next_version,
    p_r2_key,
    p_file_size_bytes,
    p_uploaded_by
  )
  RETURNING * INTO v_new_version;

  -- Set new version as active on the parent video
  UPDATE videos
     SET active_version_id = v_new_version.id,
         updated_at        = now()
   WHERE id = p_video_id;

  RETURN v_new_version;
END;
$$;
