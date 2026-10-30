-- =============================================================
-- tests/rls/purge_functions.test.sql
--
-- 0025: purge_video / purge_video_version / purge_talent_in_agency /
-- purge_agency. Runs as the migration owner (service-role equivalent);
-- the last block proves authenticated cannot execute them.
-- =============================================================

BEGIN;
SELECT plan(33);

-- ── Setup ──────────────────────────────────────────────────────
-- Agency A (usage 300): V1 (v1=100, v2=200 active; comment + reply on v1), V3 (talent's second video)
-- Agency B (usage 5):   V2 (50 bytes) for the same talent  -> exercises the floor at 0
-- Agency C:             closed wholesale by purge_agency
INSERT INTO agencies (id, name, slug, storage_usage_bytes) VALUES
  ('c0ffee25-0000-4000-a000-00000000000a'::uuid, 'Purge A', 'rls-purge-a', 300),
  ('c0ffee25-0000-4000-a000-00000000000b'::uuid, 'Purge B', 'rls-purge-b', 5),
  ('c0ffee25-0000-4000-a000-00000000000c'::uuid, 'Purge C', 'rls-purge-c', 40);

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'purge-talent@test.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');
INSERT INTO users (id, email, full_name) VALUES
  ('dbeef025-0025-4000-a000-000000000001'::uuid, 'purge-talent@test.rls', 'Purge Talent');
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef025-0025-4000-a000-000000000001'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 'talent'),
  ('dbeef025-0025-4000-a000-000000000001'::uuid, 'c0ffee25-0000-4000-a000-00000000000b'::uuid, 'talent'),
  ('dbeef025-0025-4000-a000-000000000001'::uuid, 'c0ffee25-0000-4000-a000-00000000000c'::uuid, 'talent');

INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('c0ffee25-0000-4000-a000-0000000000a1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'V1'),
  ('c0ffee25-0000-4000-a000-0000000000a3'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'V3'),
  ('c0ffee25-0000-4000-a000-0000000000a2'::uuid, 'c0ffee25-0000-4000-a000-00000000000b'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'V2'),
  ('c0ffee25-0000-4000-a000-0000000000a4'::uuid, 'c0ffee25-0000-4000-a000-00000000000c'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'V4');

INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('c0ffee25-0000-4000-a000-0000000000b1'::uuid, 'c0ffee25-0000-4000-a000-0000000000a1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 1,
   'c0ffee25-0000-4000-a000-00000000000a/c0ffee25-0000-4000-a000-0000000000a1/v1.mp4', 100, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000b2'::uuid, 'c0ffee25-0000-4000-a000-0000000000a1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 2,
   'c0ffee25-0000-4000-a000-00000000000a/c0ffee25-0000-4000-a000-0000000000a1/v2.mp4', 200, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000b3'::uuid, 'c0ffee25-0000-4000-a000-0000000000a2'::uuid, 'c0ffee25-0000-4000-a000-00000000000b'::uuid, 1,
   'c0ffee25-0000-4000-a000-00000000000b/c0ffee25-0000-4000-a000-0000000000a2/v1.mp4', 50, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000b4'::uuid, 'c0ffee25-0000-4000-a000-0000000000a3'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid, 1,
   'c0ffee25-0000-4000-a000-00000000000a/c0ffee25-0000-4000-a000-0000000000a3/v1.mp4', 0, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000b5'::uuid, 'c0ffee25-0000-4000-a000-0000000000a4'::uuid, 'c0ffee25-0000-4000-a000-00000000000c'::uuid, 1,
   'c0ffee25-0000-4000-a000-00000000000c/c0ffee25-0000-4000-a000-0000000000a4/v1.mp4', 40, 'dbeef025-0025-4000-a000-000000000001'::uuid);

UPDATE videos SET active_version_id = 'c0ffee25-0000-4000-a000-0000000000b2'::uuid WHERE id = 'c0ffee25-0000-4000-a000-0000000000a1'::uuid;
UPDATE videos SET active_version_id = 'c0ffee25-0000-4000-a000-0000000000b3'::uuid WHERE id = 'c0ffee25-0000-4000-a000-0000000000a2'::uuid;

-- Parent + reply on v1 (comments.parent_id is NO ACTION), with a notification on the reply
INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, parent_id) VALUES
  ('c0ffee25-0000-4000-a000-0000000000c1'::uuid, 'c0ffee25-0000-4000-a000-0000000000b1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid,
   'dbeef025-0025-4000-a000-000000000001'::uuid, 'parent', 'point', 1, NULL);
INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, parent_id) VALUES
  ('c0ffee25-0000-4000-a000-0000000000c2'::uuid, 'c0ffee25-0000-4000-a000-0000000000b1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid,
   'dbeef025-0025-4000-a000-000000000001'::uuid, 'reply', 'point', 1, 'c0ffee25-0000-4000-a000-0000000000c1'::uuid);
INSERT INTO notifications (agency_id, recipient_id, type, video_id, comment_id) VALUES
  ('c0ffee25-0000-4000-a000-00000000000a'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'new_comment',
   'c0ffee25-0000-4000-a000-0000000000a1'::uuid, 'c0ffee25-0000-4000-a000-0000000000c2'::uuid);
INSERT INTO guest_links (video_id, agency_id, video_version_id, token_hash, created_by) VALUES
  ('c0ffee25-0000-4000-a000-0000000000a1'::uuid, 'c0ffee25-0000-4000-a000-00000000000a'::uuid,
   'c0ffee25-0000-4000-a000-0000000000b1'::uuid, 'purge-test-hash-1', 'dbeef025-0025-4000-a000-000000000001'::uuid);

-- Agency C extras: an audit row and a pre-existing queue row (must survive the agency delete)
INSERT INTO audit_log (agency_id, actor_id, actor_name, action, resource_type, resource_id) VALUES
  ('c0ffee25-0000-4000-a000-00000000000c'::uuid, NULL, 'System', 'status_changed', 'video', 'c0ffee25-0000-4000-a000-0000000000a4'::uuid);
INSERT INTO storage_deletions (agency_id, target, is_prefix, reason) VALUES
  ('c0ffee25-0000-4000-a000-00000000000c'::uuid, 'c0ffee25-0000-4000-a000-00000000000c/c0ffee25-0000-4000-a000-0000000000a4/old-key.mp4', false, 'video_purged');

SELECT ok(
  (SELECT count(*) FROM comments WHERE video_version_id = 'c0ffee25-0000-4000-a000-0000000000b1'::uuid) = 2,
  'fixture: parent and reply exist on v1');

-- ── purge_video_version ───────────────────────────────────────
SELECT throws_ok(
  $$SELECT purge_video_version('c0ffee25-0000-4000-a000-0000000000b2'::uuid,'version_purged',NULL,'System')$$,
  'P0409', NULL, 'refuses the active version');
SELECT is((SELECT count(*) FROM storage_deletions WHERE agency_id = 'c0ffee25-0000-4000-a000-00000000000a'::uuid), 0::bigint,
  'nothing queued after refusal');
SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id = 'c0ffee25-0000-4000-a000-00000000000a'::uuid), 300::bigint,
  'nothing decremented after refusal');

SELECT is(purge_video_version('c0ffee25-0000-4000-a000-0000000000b1'::uuid,'version_purged',NULL,'System'), 100::bigint,
  'old version purge returns bytes freed');
SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id = 'c0ffee25-0000-4000-a000-00000000000a'::uuid), 200::bigint,
  'counter decremented');
SELECT is((SELECT count(*) FROM comments WHERE video_version_id = 'c0ffee25-0000-4000-a000-0000000000b1'::uuid), 0::bigint,
  'parent and reply both removed in one cascade (parent_id NO ACTION not violated)');
SELECT is((SELECT count(*) FROM notifications WHERE comment_id = 'c0ffee25-0000-4000-a000-0000000000c2'::uuid), 0::bigint,
  'notification on a purged comment cascades');
SELECT is((SELECT count(*) FROM guest_links WHERE token_hash = 'purge-test-hash-1'), 0::bigint,
  'guest link pinned to the purged version cascades');
SELECT is((SELECT target FROM storage_deletions WHERE agency_id = 'c0ffee25-0000-4000-a000-00000000000a'::uuid ORDER BY id DESC LIMIT 1),
  'c0ffee25-0000-4000-a000-00000000000a/c0ffee25-0000-4000-a000-0000000000a1/v1.mp4', 'exact key queued');
SELECT is(purge_video_version('c0ffee25-0000-4000-a000-0000000000b1'::uuid,'version_purged',NULL,'System'), 0::bigint,
  'purge_video_version idempotent');

-- ── purge_video ───────────────────────────────────────────────
SELECT is(purge_video('c0ffee25-0000-4000-a000-0000000000a1'::uuid,'video_purged',NULL,'System'), 200::bigint,
  'video purge frees remaining bytes');
SELECT ok(EXISTS(SELECT 1 FROM storage_deletions
  WHERE target = 'c0ffee25-0000-4000-a000-00000000000a/c0ffee25-0000-4000-a000-0000000000a1/' AND is_prefix),
  'prefix queued');
SELECT ok(EXISTS(SELECT 1 FROM audit_log
  WHERE action = 'video_purged' AND resource_id = 'c0ffee25-0000-4000-a000-0000000000a1'::uuid),
  'audit row written');
SELECT is(purge_video('c0ffee25-0000-4000-a000-0000000000a1'::uuid,'video_purged',NULL,'System'), 0::bigint,
  'purge_video idempotent');
SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id = 'c0ffee25-0000-4000-a000-00000000000a'::uuid), 0::bigint,
  'counter reached 0 after both purges (not negative on the repeat)');

-- ── purge_talent_in_agency ────────────────────────────────────
SELECT lives_ok($$SELECT purge_talent_in_agency('dbeef025-0025-4000-a000-000000000001'::uuid,'c0ffee25-0000-4000-a000-00000000000a'::uuid,NULL,'System')$$,
  'purge_talent_in_agency runs');
SELECT is((SELECT count(*) FROM videos WHERE id = 'c0ffee25-0000-4000-a000-0000000000a3'::uuid), 0::bigint,
  'scoped removal purges the talent''s video in that agency');
SELECT is((SELECT count(*) FROM videos WHERE id = 'c0ffee25-0000-4000-a000-0000000000a2'::uuid), 1::bigint,
  'scoped removal leaves the other agency''s video intact');

-- counter floors at 0 (drift: usage 5 < 50 bytes freed)
SELECT lives_ok($$SELECT purge_video('c0ffee25-0000-4000-a000-0000000000a2'::uuid,'talent_erased',NULL,'System')$$,
  'purge_video (drifted counter) runs');
SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id = 'c0ffee25-0000-4000-a000-00000000000b'::uuid), 0::bigint,
  'counter floors at 0');

-- ── purge_agency ──────────────────────────────────────────────
SELECT is(purge_agency('c0ffee25-0000-4000-a000-00000000000c'::uuid), 40::bigint, 'purge_agency returns bytes');
SELECT is(
  (SELECT count(*) FROM videos WHERE agency_id = 'c0ffee25-0000-4000-a000-00000000000c'::uuid)
  + (SELECT count(*) FROM memberships WHERE agency_id = 'c0ffee25-0000-4000-a000-00000000000c'::uuid)
  + (SELECT count(*) FROM audit_log WHERE agency_id = 'c0ffee25-0000-4000-a000-00000000000c'::uuid)
  + (SELECT count(*) FROM agencies WHERE id = 'c0ffee25-0000-4000-a000-00000000000c'::uuid),
  0::bigint, 'no videos/memberships/audit_log/agency rows left');
SELECT ok(
  EXISTS(SELECT 1 FROM storage_deletions WHERE target = 'c0ffee25-0000-4000-a000-00000000000c/' AND is_prefix)
  AND EXISTS(SELECT 1 FROM storage_deletions WHERE target = 'c0ffee25-0000-4000-a000-00000000000c/c0ffee25-0000-4000-a000-0000000000a4/old-key.mp4'),
  'agency prefix queued and earlier queue rows survive the agency delete');

-- ── purge_video_version: unsafe keys are never queued ─────────
-- V5 (agency D): v1 = legacy out-of-prefix key, v2/v3 share one key (replayed upload/complete), v4 active.
INSERT INTO agencies (id, name, slug, storage_usage_bytes) VALUES
  ('c0ffee25-0000-4000-a000-00000000000d'::uuid, 'Purge D', 'rls-purge-d', 1000);
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef025-0025-4000-a000-000000000001'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 'talent');
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('c0ffee25-0000-4000-a000-0000000000a5'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 'dbeef025-0025-4000-a000-000000000001'::uuid, 'V5');
INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('c0ffee25-0000-4000-a000-0000000000d1'::uuid, 'c0ffee25-0000-4000-a000-0000000000a5'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 1,
   'seed/staging/legacy/v1.mp4', 10, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000d2'::uuid, 'c0ffee25-0000-4000-a000-0000000000a5'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 2,
   'c0ffee25-0000-4000-a000-00000000000d/c0ffee25-0000-4000-a000-0000000000a5/shared.mp4', 20, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000d3'::uuid, 'c0ffee25-0000-4000-a000-0000000000a5'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 3,
   'c0ffee25-0000-4000-a000-00000000000d/c0ffee25-0000-4000-a000-0000000000a5/shared.mp4', 20, 'dbeef025-0025-4000-a000-000000000001'::uuid),
  ('c0ffee25-0000-4000-a000-0000000000d4'::uuid, 'c0ffee25-0000-4000-a000-0000000000a5'::uuid, 'c0ffee25-0000-4000-a000-00000000000d'::uuid, 4,
   'c0ffee25-0000-4000-a000-00000000000d/c0ffee25-0000-4000-a000-0000000000a5/v4.mp4', 30, 'dbeef025-0025-4000-a000-000000000001'::uuid);
UPDATE videos SET active_version_id = 'c0ffee25-0000-4000-a000-0000000000d4'::uuid WHERE id = 'c0ffee25-0000-4000-a000-0000000000a5'::uuid;

SELECT is(purge_video_version('c0ffee25-0000-4000-a000-0000000000d1'::uuid,'version_purged',NULL,'System'), 10::bigint,
  'out-of-prefix version still purged and counted');
SELECT is((SELECT count(*) FROM storage_deletions WHERE target = 'seed/staging/legacy/v1.mp4'), 0::bigint,
  'out-of-prefix key is not queued');
SELECT is((SELECT metadata->>'key_queued' FROM audit_log WHERE resource_id = 'c0ffee25-0000-4000-a000-0000000000a5'::uuid
  AND metadata->>'version_id' = 'c0ffee25-0000-4000-a000-0000000000d1' ), 'false',
  'audit row records key_queued=false');

SELECT is(purge_video_version('c0ffee25-0000-4000-a000-0000000000d2'::uuid,'version_purged',NULL,'System'), 20::bigint, 'shared-key version still purged and counted');
SELECT is((SELECT count(*) FROM storage_deletions WHERE target LIKE '%/shared.mp4'), 0::bigint,
  'key shared with another version is not queued');
SELECT is((SELECT count(*) FROM video_versions WHERE id = 'c0ffee25-0000-4000-a000-0000000000d3'::uuid), 1::bigint,
  'the other version sharing the key is untouched');

-- 0024 key-shape CHECK
SELECT throws_ok(
  $$INSERT INTO storage_deletions(target, is_prefix, reason) VALUES ('seed/staging/x.mp4', false, 'version_purged')$$,
  '23514', NULL, 'rejects malformed exact key');

-- ── privileges ────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef025-0025-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT purge_agency('c0ffee25-0000-4000-a000-00000000000a'::uuid)$$, '42501', NULL,
  'authenticated cannot execute purge_agency');
SELECT throws_ok($$SELECT purge_video('c0ffee25-0000-4000-a000-0000000000a1'::uuid,'video_purged',NULL,'x')$$, '42501', NULL,
  'authenticated cannot execute purge_video');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
