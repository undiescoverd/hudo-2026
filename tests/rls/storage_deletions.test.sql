-- =============================================================
-- tests/rls/storage_deletions.test.sql
--
-- 0024: storage_deletions queue (RLS, privileges, prefix shape) and the
-- cascade FK fixes (notifications / guest_links / active_version_id).
-- =============================================================

BEGIN;
SELECT plan(9);

-- ── Setup ──────────────────────────────────────────────────────
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee24-0000-4000-a000-000000000001'::uuid, 'Deletions Agency', 'rls-deletions');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef024-0024-4000-a000-000000000001'::uuid, 'del-agent@test.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef024-0024-4000-a000-000000000001'::uuid, 'del-agent@test.rls', 'Del Agent');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef024-0024-4000-a000-000000000001'::uuid, 'c0ffee24-0000-4000-a000-000000000001'::uuid, 'agent');

INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('c0ffee24-0000-4000-a000-0000000000a1'::uuid, 'c0ffee24-0000-4000-a000-000000000001'::uuid, 'dbeef024-0024-4000-a000-000000000001'::uuid, 'Del Video');

INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('c0ffee24-0000-4000-a000-0000000000b1'::uuid, 'c0ffee24-0000-4000-a000-0000000000a1'::uuid, 'c0ffee24-0000-4000-a000-000000000001'::uuid, 1,
   'c0ffee24-0000-4000-a000-000000000001/c0ffee24-0000-4000-a000-0000000000a1/v1.mp4', 100, 'dbeef024-0024-4000-a000-000000000001'::uuid);

UPDATE videos SET active_version_id = 'c0ffee24-0000-4000-a000-0000000000b1'::uuid
 WHERE id = 'c0ffee24-0000-4000-a000-0000000000a1'::uuid;

INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds) VALUES
  ('c0ffee24-0000-4000-a000-0000000000c1'::uuid, 'c0ffee24-0000-4000-a000-0000000000b1'::uuid, 'c0ffee24-0000-4000-a000-000000000001'::uuid,
   'dbeef024-0024-4000-a000-000000000001'::uuid, 'hello', 'point', 1);

INSERT INTO notifications (agency_id, recipient_id, type, video_id, comment_id) VALUES
  ('c0ffee24-0000-4000-a000-000000000001'::uuid, 'dbeef024-0024-4000-a000-000000000001'::uuid, 'new_comment',
   'c0ffee24-0000-4000-a000-0000000000a1'::uuid, 'c0ffee24-0000-4000-a000-0000000000c1'::uuid);

INSERT INTO guest_links (video_id, agency_id, video_version_id, token_hash, created_by) VALUES
  ('c0ffee24-0000-4000-a000-0000000000a1'::uuid, 'c0ffee24-0000-4000-a000-000000000001'::uuid,
   'c0ffee24-0000-4000-a000-0000000000b1'::uuid, 'deletions-test-hash', 'dbeef024-0024-4000-a000-000000000001'::uuid);

-- ── Tests ──────────────────────────────────────────────────────
SELECT has_table('public', 'storage_deletions', 'queue table exists');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE relname = 'storage_deletions'), 'RLS enabled');

-- authenticated has no privileges at all on the queue
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef024-0024-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT count(*) FROM storage_deletions$$, '42501', NULL, 'authenticated cannot read the queue');
SELECT throws_ok(
  $$INSERT INTO storage_deletions(target, is_prefix, reason) VALUES ('x/', true, 'video_purged')$$,
  '42501', NULL, 'authenticated cannot insert');
RESET ROLE;

-- prefix shape guard
SELECT throws_ok(
  $$INSERT INTO storage_deletions(target, is_prefix, reason) VALUES ('c0ffee24-0000-4000-a000-000000000001/vid', true, 'video_purged')$$,
  '23514', NULL, 'rejects malformed prefix');

-- cascades now succeed (the pre-0024 FKs made this DELETE fail)
DELETE FROM videos WHERE id = 'c0ffee24-0000-4000-a000-0000000000a1'::uuid;
SELECT is((SELECT count(*) FROM notifications WHERE video_id = 'c0ffee24-0000-4000-a000-0000000000a1'::uuid), 0::bigint,
  'notifications cascade with video');
SELECT is((SELECT count(*) FROM guest_links WHERE video_id = 'c0ffee24-0000-4000-a000-0000000000a1'::uuid), 0::bigint,
  'guest links cascade with video');
SELECT is((SELECT count(*) FROM comments WHERE video_version_id = 'c0ffee24-0000-4000-a000-0000000000b1'::uuid), 0::bigint,
  'comments cascade with video');

-- active_version_id is SET NULL (deleting a version no longer blocked by the pointer)
SELECT is((SELECT confdeltype::text FROM pg_constraint WHERE conname = 'videos_active_version_id_fkey'), 'n',
  'videos.active_version_id is ON DELETE SET NULL');

SELECT * FROM finish();
ROLLBACK;
