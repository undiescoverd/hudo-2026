-- =============================================================
-- tests/rls/videos.test.sql
--
-- PRD Policies enforced:
--   videos_select_agents  — Agents/owners/admin_agents see all videos
--                           in their agency; cross-agency read is blocked.
--   videos_select_talent  — Talent can only read their own videos
--                           (talent_id = auth.uid()), not other talent's.
--   videos_insert         — Only agents+ can insert videos; talent has
--                           no INSERT policy and is blocked.
--   videos_update_talent  — Talent can update only their own videos.
-- =============================================================

BEGIN;
SELECT plan(8);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

-- Two agencies
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee02-0000-4000-a000-000000000001'::uuid, 'Video Agency A', 'rls-vid-agency-a'),
  ('c0ffee02-0000-4000-a000-000000000002'::uuid, 'Video Agency B', 'rls-vid-agency-b');

-- Five users: agent and 2 talent in Agency A; agent + talent in Agency B
INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef002-0002-4000-a000-000000000001'::uuid, 'agent-a@videos.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef002-0002-4000-a000-000000000002'::uuid, 'talent-tara@videos.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef002-0002-4000-a000-000000000003'::uuid, 'talent-tom@videos.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef002-0002-4000-a000-000000000004'::uuid, 'agent-b@videos.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef002-0002-4000-a000-000000000005'::uuid, 'talent-bob@videos.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef002-0002-4000-a000-000000000001'::uuid, 'agent-a@videos.rls',   'Agent Alpha'),
  ('dbeef002-0002-4000-a000-000000000002'::uuid, 'talent-tara@videos.rls', 'Talent Tara'),
  ('dbeef002-0002-4000-a000-000000000003'::uuid, 'talent-tom@videos.rls',  'Talent Tom'),
  ('dbeef002-0002-4000-a000-000000000004'::uuid, 'agent-b@videos.rls',   'Agent Beta'),
  ('dbeef002-0002-4000-a000-000000000005'::uuid, 'talent-bob@videos.rls',  'Talent Bob');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef002-0002-4000-a000-000000000001'::uuid, 'c0ffee02-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef002-0002-4000-a000-000000000002'::uuid, 'c0ffee02-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef002-0002-4000-a000-000000000003'::uuid, 'c0ffee02-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef002-0002-4000-a000-000000000004'::uuid, 'c0ffee02-0000-4000-a000-000000000002'::uuid, 'agent'),
  ('dbeef002-0002-4000-a000-000000000005'::uuid, 'c0ffee02-0000-4000-a000-000000000002'::uuid, 'talent');

-- Videos: two in Agency A (owned by Tara and Tom), one in Agency B
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0002-0002-4000-a000-000000000001'::uuid, 'c0ffee02-0000-4000-a000-000000000001'::uuid, 'dbeef002-0002-4000-a000-000000000002'::uuid, 'Taras Showreel'),
  ('b1de0002-0002-4000-a000-000000000002'::uuid, 'c0ffee02-0000-4000-a000-000000000001'::uuid, 'dbeef002-0002-4000-a000-000000000003'::uuid, 'Toms Showreel'),
  ('b1de0002-0002-4000-a000-000000000003'::uuid, 'c0ffee02-0000-4000-a000-000000000002'::uuid, 'dbeef002-0002-4000-a000-000000000005'::uuid, 'Bobs Showreel');


-- ── Test 1: videos_select_agents — agent sees all agency videos ───────
-- PRD: Agents can see all videos within their agency.

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM videos),
  2,
  'videos_select_agents: Agent Alpha sees both videos in Agency A'
);


-- ── Test 2: videos_select_agents — cross-agency read blocked ─────────
-- PRD: Cross-agency data access is impossible.
SELECT is(
  (SELECT count(*)::int FROM videos
    WHERE id = 'b1de0002-0002-4000-a000-000000000003'::uuid),
  0,
  'videos_select_agents: Agent Alpha cannot see Agency B video (cross-agency)'
);


-- ── Test 3: videos_select_talent — talent sees only their own videos ──
-- PRD: Talent can only see their own videos (talent_id = auth.uid()).
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM videos),
  1,
  'videos_select_talent: Tara sees exactly 1 video (her own)'
);


-- ── Test 4: videos_select_talent — correct video returned for talent ──
SELECT is(
  (SELECT id FROM videos LIMIT 1),
  'b1de0002-0002-4000-a000-000000000001'::uuid,
  'videos_select_talent: Tara sees Video 1 (hers), not Tom''s'
);


-- ── Test 5: videos_select_talent — talent cannot see another talent's video
-- PRD: Talent cannot read other talent's videos.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM videos
    WHERE id = 'b1de0002-0002-4000-a000-000000000001'::uuid),
  0,
  'videos_select_talent: Tom cannot read Tara''s video (same-agency talent isolation)'
);


-- ── Test 6: videos_insert — agent can insert a video ─────────────────
-- PRD: Agents can upload videos for their agency.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO videos (id, agency_id, talent_id, title)
    VALUES (
      'b1de0002-0002-4000-a000-000000000004'::uuid,
      'c0ffee02-0000-4000-a000-000000000001'::uuid,
      'dbeef002-0002-4000-a000-000000000002'::uuid,
      'Agent-Uploaded Video'
    )$$,
  'videos_insert: Agent Alpha can insert a video in Agency A'
);


-- ── Test 7: videos_insert — talent has no INSERT policy (blocked) ─────
-- PRD: Talent cannot upload videos directly; only agents can.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO videos (id, agency_id, talent_id, title)
    VALUES (
      'b1de0002-0002-4000-a000-000000000099'::uuid,
      'c0ffee02-0000-4000-a000-000000000001'::uuid,
      'dbeef002-0002-4000-a000-000000000002'::uuid,
      'Talent Unauthorised Upload'
    )$$,
  '42501',
  'new row violates row-level security policy for table "videos"',
  'videos_insert: Talent has no INSERT policy — upload blocked'
);


-- ── Test 8: videos_insert WITH CHECK — agent cannot insert for other agency
-- PRD: An agent in Agency A cannot create a video in Agency B.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef002-0002-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO videos (id, agency_id, talent_id, title)
    VALUES (
      'b1de0002-0002-4000-a000-000000000098'::uuid,
      'c0ffee02-0000-4000-a000-000000000002'::uuid,
      'dbeef002-0002-4000-a000-000000000005'::uuid,
      'Cross-Agency Video Injection'
    )$$,
  '42501',
  'new row violates row-level security policy for table "videos"',
  'videos_insert WITH CHECK: Agent Alpha cannot insert video into Agency B'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
