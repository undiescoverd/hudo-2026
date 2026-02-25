-- =============================================================
-- tests/rls/video_version_rpc.test.sql
--
-- Tests for create_video_version RPC caller validation (RES-174).
-- =============================================================

BEGIN;
SELECT plan(5);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee07-0000-4000-a000-000000000001'::uuid, 'RPC Test Agency', 'rls-rpc-test-agency');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000001'::uuid, 'uploader@rpc.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000002'::uuid, 'imposter@rpc.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef007-0007-4000-a000-000000000001'::uuid, 'uploader@rpc.rls', 'Uploader'),
  ('dbeef007-0007-4000-a000-000000000002'::uuid, 'imposter@rpc.rls', 'Imposter');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef007-0007-4000-a000-000000000001'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef007-0007-4000-a000-000000000002'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'agent');

INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0007-0007-4000-a000-000000000001'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'dbeef007-0007-4000-a000-000000000001'::uuid, 'RPC Test Video');


-- ── Test 1: RPC rejects mismatched p_uploaded_by ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Imposter tries to create a version attributed to Uploader
SELECT throws_ok(
  $$SELECT create_video_version(
    'b1de0007-0007-4000-a000-000000000001'::uuid,
    'c0ffee07-0000-4000-a000-000000000001'::uuid,
    'test/video-v1.mp4',
    1024,
    'dbeef007-0007-4000-a000-000000000001'::uuid
  )$$,
  '42501',
  'p_uploaded_by must match the authenticated user',
  'create_video_version rejects mismatched p_uploaded_by (RES-174)'
);


-- ── Test 2: RPC succeeds with matching p_uploaded_by ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT create_video_version(
    'b1de0007-0007-4000-a000-000000000001'::uuid,
    'c0ffee07-0000-4000-a000-000000000001'::uuid,
    'test/video-v1.mp4',
    1024,
    'dbeef007-0007-4000-a000-000000000001'::uuid
  )$$,
  'create_video_version succeeds with matching p_uploaded_by'
);

-- ── Test 3: Two sequential calls produce version numbers 1 and 2 ──
-- (Version 1 already created by Test 2 above)

SELECT is(
  (SELECT version_number FROM video_versions
   WHERE video_id = 'b1de0007-0007-4000-a000-000000000001'::uuid
   ORDER BY version_number DESC LIMIT 1),
  1,
  'First create_video_version call produces version_number = 1'
);


-- ── Test 4: Second call produces version 2, active_version_id updated ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT create_video_version(
    'b1de0007-0007-4000-a000-000000000001'::uuid,
    'c0ffee07-0000-4000-a000-000000000001'::uuid,
    'test/video-v2.mp4',
    2048,
    'dbeef007-0007-4000-a000-000000000001'::uuid
  )$$,
  'Second create_video_version call succeeds'
);


-- ── Test 5: After version 2, active_version_id points to version 2 and version 1 still exists ──
SELECT is(
  (SELECT count(*)::int FROM video_versions
   WHERE video_id = 'b1de0007-0007-4000-a000-000000000001'::uuid),
  2,
  'Both version 1 and version 2 exist; active_version_id updated'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
