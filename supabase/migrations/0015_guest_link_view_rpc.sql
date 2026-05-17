-- HUDO — GUEST LINK ATOMIC VIEW INCREMENT
-- Atomic single-statement update so concurrent playback hits do not collapse.
-- Mirrors the project rule: counters/version-numbers via Postgres, not app logic.

CREATE OR REPLACE FUNCTION increment_guest_link_view(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.guest_links
     SET view_count = view_count + 1,
         last_viewed_at = now()
   WHERE id = p_id
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now());
$$;

REVOKE ALL ON FUNCTION increment_guest_link_view(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION increment_guest_link_view(uuid) TO service_role;
