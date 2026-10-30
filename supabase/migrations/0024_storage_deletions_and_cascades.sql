-- ============================================================
-- HUDO — STORAGE DELETION QUEUE + CASCADE FIXES
-- 0024_storage_deletions_and_cascades.sql
--
-- Spec: docs/superpowers/specs/2026-10-14-archive-deletion-gdpr-design.md (D7)
--
-- 1. Four FKs had no ON DELETE rule (NO ACTION), so deleting a video,
--    version or comment failed whenever a notification / guest link /
--    active-version pointer still referenced it:
--      notifications.video_id           -> videos          (now CASCADE)
--      notifications.comment_id         -> comments        (now CASCADE)
--      guest_links.video_version_id     -> video_versions  (now CASCADE)
--      videos.active_version_id         -> video_versions  (now SET NULL)
--    comments.parent_id stays NO ACTION: a cascade removes parent and reply
--    in ONE DELETE statement and NO ACTION is checked at statement end, so
--    it is never violated (proven in tests/rls/purge_functions.test.sql).
-- 2. storage_deletions: the queue the daily cron drains to delete R2 objects.
--
-- audit_log.action gains two values (comment only, no CHECK exists):
--   video_purged, version_purged
-- ============================================================

-- 1. Unblock cascades
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_video_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_video_id_fkey
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_comment_id_fkey;
ALTER TABLE notifications ADD CONSTRAINT notifications_comment_id_fkey
  FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;

ALTER TABLE guest_links DROP CONSTRAINT IF EXISTS guest_links_video_version_id_fkey;
ALTER TABLE guest_links ADD CONSTRAINT guest_links_video_version_id_fkey
  FOREIGN KEY (video_version_id) REFERENCES video_versions(id) ON DELETE CASCADE;

ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_active_version_id_fkey;
ALTER TABLE videos ADD CONSTRAINT videos_active_version_id_fkey
  FOREIGN KEY (active_version_id) REFERENCES video_versions(id) ON DELETE SET NULL;

-- 2. R2 deletion queue. agency_id deliberately has NO FK: rows must outlive a purged agency.
CREATE TABLE IF NOT EXISTS storage_deletions (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id    uuid,
  target       text NOT NULL,
  is_prefix    boolean NOT NULL DEFAULT false,
  bytes        bigint NOT NULL DEFAULT 0,
  reason       text NOT NULL CHECK (reason IN
                 ('version_purged','video_purged','talent_erased','agency_closed','empty_draft','retention_expired')),
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  completed_at timestamptz,
  -- A prefix is exactly "{uuid}/" or "{uuid}/{uuid}/": it can never match a sibling tenant/video.
  CONSTRAINT storage_deletions_prefix_shape CHECK (
    NOT is_prefix OR target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?$'
  )
);

CREATE INDEX IF NOT EXISTS storage_deletions_pending_idx
  ON storage_deletions (enqueued_at) WHERE completed_at IS NULL;

ALTER TABLE storage_deletions ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only service_role (which bypasses RLS) touches this table.
-- Supabase default privileges grant anon/authenticated directly, so revoke from them explicitly.
REVOKE ALL ON storage_deletions FROM PUBLIC, anon, authenticated;
