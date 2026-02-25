-- =============================================================
-- tests/rls/memberships.test.sql
--
-- PRD Policies enforced:
--   memberships_select — Members can see all memberships within
--                        agencies they belong to; cross-agency
--                        membership data is invisible.
--   No INSERT policy   — Memberships created via service role only.
--   No DELETE policy   — Memberships deleted via service role only.
-- =============================================================

BEGIN;
SELECT plan(6);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee04-0000-4000-a000-000000000001'::uuid, 'Membership Agency E', 'rls-membership-agency-e'),
  ('c0ffee04-0000-4000-a000-000000000002'::uuid, 'Membership Agency F', 'rls-membership-agency-f');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000001'::uuid, 'eve@memberships.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000002'::uuid, 'frank@memberships.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000003'::uuid, 'grace@memberships.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef004-0004-4000-a000-000000000001'::uuid, 'eve@memberships.rls',   'Eve Agent'),
  ('dbeef004-0004-4000-a000-000000000002'::uuid, 'frank@memberships.rls', 'Frank Agent'),
  ('dbeef004-0004-4000-a000-000000000003'::uuid, 'grace@memberships.rls', 'Grace Talent');

-- Eve + Grace in Agency E; Frank in Agency F
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef004-0004-4000-a000-000000000001'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef004-0004-4000-a000-000000000003'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef004-0004-4000-a000-000000000002'::uuid, 'c0ffee04-0000-4000-a000-000000000002'::uuid, 'agent');


-- ── Test 1: memberships_select — agent sees all memberships in their agency ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM memberships),
  2,
  'memberships_select: Eve sees both memberships in Agency E'
);


-- ── Test 2: memberships_select — talent sees same-agency memberships ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM memberships),
  2,
  'memberships_select: Grace (talent) sees both memberships in Agency E'
);


-- ── Test 3: memberships_select — cross-agency isolation ──
SELECT is(
  (SELECT count(*)::int FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000002'::uuid),
  0,
  'memberships_select: Grace cannot see Frank membership in Agency F (cross-agency isolation)'
);


-- ── Test 4: memberships_select — Frank sees only Agency F memberships ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM memberships),
  1,
  'memberships_select: Frank sees only his own membership in Agency F'
);


-- ── Test 5: No INSERT policy — authenticated user cannot insert memberships ──
SELECT throws_ok(
  $$INSERT INTO memberships (user_id, agency_id, role)
    VALUES (
      'dbeef004-0004-4000-a000-000000000002'::uuid,
      'c0ffee04-0000-4000-a000-000000000001'::uuid,
      'agent'
    )$$,
  '42501',
  'new row violates row-level security policy for table "memberships"',
  'No INSERT policy: authenticated user cannot insert memberships'
);


-- ── Test 6: No DELETE policy — authenticated user cannot delete memberships ──
DELETE FROM memberships
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000002'::uuid;

-- Frank's membership must still exist (verified as superuser)
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000002'::uuid),
  1,
  'No DELETE policy: authenticated user cannot delete memberships'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
