-- HUDO — GUEST-WATCHED NOTIFICATION (S5-GUEST-004, GH #170)
-- 1. Allow the 'guest_viewed' notification type.
-- 2. increment_guest_link_view now RETURNS the new view_count so the caller can
--    tell the first watch (count = 1) from later ones. The single UPDATE takes a
--    row lock, so two simultaneous first plays get distinct counts (1 and 2):
--    exactly one caller sees 1. NULL = no row matched (revoked/expired/unknown).
-- Idempotent: safe to re-run.

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_comment', 'comment_resolved', 'status_changed', 'invitation_accepted', 'guest_viewed'));

-- The return type changes (void -> integer), which CREATE OR REPLACE cannot do.
DROP FUNCTION IF EXISTS increment_guest_link_view(uuid);

CREATE FUNCTION increment_guest_link_view(p_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE public.guest_links
     SET view_count = view_count + 1,
         last_viewed_at = now()
   WHERE id = p_id
     AND revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > now())
  RETURNING view_count;
$$;

-- Supabase also grants EXECUTE directly to anon/authenticated (see GH #186), and
-- REVOKE FROM PUBLIC does not remove those. Service role only.
REVOKE ALL ON FUNCTION increment_guest_link_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_guest_link_view(uuid) TO service_role;
