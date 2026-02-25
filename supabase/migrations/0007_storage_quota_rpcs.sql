-- ============================================================
-- HUDO — STORAGE QUOTA RPCs
-- 0007_storage_quota_rpcs.sql
--
-- Atomic storage quota enforcement via row-level locking.
-- increment_storage_usage: called on upload complete
-- decrement_storage_usage: called on delete (future)
-- ============================================================

CREATE OR REPLACE FUNCTION increment_storage_usage(
  p_agency_id uuid,
  p_bytes     bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current bigint;
  v_limit   bigint;
BEGIN
  -- Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Lock agency row to prevent concurrent quota races
  SELECT storage_usage_bytes, storage_limit_bytes
    INTO v_current, v_limit
    FROM agencies
   WHERE id = p_agency_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agency not found'
      USING ERRCODE = 'P0404';
  END IF;

  -- Check quota
  IF v_current + p_bytes > v_limit THEN
    RAISE EXCEPTION 'Storage quota exceeded'
      USING ERRCODE = 'P0402';
  END IF;

  -- Increment usage
  UPDATE agencies
     SET storage_usage_bytes = storage_usage_bytes + p_bytes
   WHERE id = p_agency_id;
END;
$$;

CREATE OR REPLACE FUNCTION decrement_storage_usage(
  p_agency_id uuid,
  p_bytes     bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Require authenticated caller
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;

  -- Lock and decrement with floor at 0
  UPDATE agencies
     SET storage_usage_bytes = GREATEST(0, storage_usage_bytes - p_bytes)
   WHERE id = p_agency_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agency not found'
      USING ERRCODE = 'P0404';
  END IF;
END;
$$;
