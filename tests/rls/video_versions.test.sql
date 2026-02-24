-- =============================================================
-- tests/rls/video_versions.test.sql
--
-- PRD Policies enforced:
--   video_versions_select — Agents/owners/admin_agents see all
--                           versions in their agency; talent sees
--                           only versions of their own videos.
--   video_versions_insert — Agents+ can insert versions
--                           (uploaded_by = self).
--   Cross-agency         — No cross-agency access.
-- =============================================================

BEGIN;
SELECT plan(6);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee07-0000-4000-a000-000000000001'::uuid, 'Version Agency K', 'rls-version-agency-k'),
  ('c0ffee07-0000-4000-a000-000000000002'::uuid, 'Version Agency L', 'rls-version-agency-l');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000001'::uuid, 'agent-k@versions.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000002'::uuid, 'talent-k1@versions.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000003'::uuid, 'talent-k2@versions.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef007-0007-4000-a000-000000000004'::uuid, 'agent-l@versions.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef007-0007-4000-a000-000000000001'::uuid, 'agent-k@versions.rls',   'Agent K'),
  ('dbeef007-0007-4000-a000-000000000002'::uuid, 'talent-k1@versions.rls', 'Talent K1'),
  ('dbeef007-0007-4000-a000-000000000003'::uuid, 'talent-k2@versions.rls', 'Talent K2'),
  ('dbeef007-0007-4000-a000-000000000004'::uuid, 'agent-l@versions.rls',   'Agent L');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef007-0007-4000-a000-000000000001'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef007-0007-4000-a000-000000000002'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef007-0007-4000-a000-000000000003'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef007-0007-4000-a000-000000000004'::uuid, 'c0ffee07-0000-4000-a000-000000000002'::uuid, 'agent');

-- Videos: one per talent in Agency K
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0007-0007-4000-a000-000000000001'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'dbeef007-0007-4000-a000-000000000002'::uuid, 'K1 Showreel'),
  ('b1de0007-0007-4000-a000-000000000002'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 'dbeef007-0007-4000-a000-000000000003'::uuid, 'K2 Showreel');

INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('bee00007-0007-4000-a000-000000000001'::uuid, 'b1de0007-0007-4000-a000-000000000001'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 1, 'k/k1-v1.mp4', 100000000, 'dbeef007-0007-4000-a000-000000000001'::uuid),
  ('bee00007-0007-4000-a000-000000000002'::uuid, 'b1de0007-0007-4000-a000-000000000002'::uuid, 'c0ffee07-0000-4000-a000-000000000001'::uuid, 1, 'k/k2-v1.mp4', 100000000, 'dbeef007-0007-4000-a000-000000000001'::uuid);


-- ── Test 1: video_versions_select — agent sees all versions in their agency ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM video_versions),
  2,
  'video_versions_select: Agent K sees all 2 versions in Agency K'
);


-- ── Test 2: video_versions_select — talent sees only own video versions ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM video_versions),
  1,
  'video_versions_select: Talent K1 sees only their own video version'
);


-- ── Test 3: video_versions_select — talent cannot see other talent versions ──
SELECT is(
  (SELECT count(*)::int FROM video_versions
    WHERE video_id = 'b1de0007-0007-4000-a000-000000000002'::uuid),
  0,
  'video_versions_select: Talent K1 cannot see Talent K2 video version'
);


-- ── Test 4: video_versions_select — cross-agency isolation ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM video_versions),
  0,
  'video_versions_select: Agent L cannot see Agency K versions (cross-agency isolation)'
);


-- ── Test 5: video_versions_insert — agent can insert version ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by)
    VALUES (
      'bee00007-0007-4000-a000-000000000099'::uuid,
      'b1de0007-0007-4000-a000-000000000001'::uuid,
      'c0ffee07-0000-4000-a000-000000000001'::uuid,
      2, 'k/k1-v2.mp4', 200000000,
      'dbeef007-0007-4000-a000-000000000001'::uuid
    )$$,
  'video_versions_insert: Agent K can insert version in Agency K'
);


-- ── Test 6: video_versions_insert — talent cannot insert versions ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef007-0007-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by)
    VALUES (
      'bee00007-0007-4000-a000-000000000098'::uuid,
      'b1de0007-0007-4000-a000-000000000001'::uuid,
      'c0ffee07-0000-4000-a000-000000000001'::uuid,
      3, 'k/k1-v3.mp4', 300000000,
      'dbeef007-0007-4000-a000-000000000002'::uuid
    )$$,
  '42501',
  'new row violates row-level security policy for table "video_versions"',
  'video_versions_insert: Talent K1 cannot insert versions'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
