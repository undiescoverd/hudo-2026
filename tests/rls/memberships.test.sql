-- =============================================================
-- tests/rls/memberships.test.sql
--
-- PRD Policies enforced:
--   memberships_select — Members can see all memberships within
--                        agencies they belong to; cross-agency
--                        membership data is invisible.
--   No INSERT policy   — Memberships created via service role only.
--   No DELETE policy   — Memberships deleted via service role only.
--   can_manage_billing (0033) — column shape, default false, never client-writable,
--                        cleared when the member stops being an admin_agent.
-- =============================================================

BEGIN;
SELECT plan(15);

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

-- ============================================================
-- can_manage_billing (0033, S5-ADMIN-001)
-- ============================================================
RESET ROLE;

SELECT col_type_is('public', 'memberships', 'can_manage_billing', 'boolean',
  'can_manage_billing is boolean');
SELECT col_not_null('public', 'memberships', 'can_manage_billing',
  'can_manage_billing is NOT NULL');
SELECT col_default_is('public', 'memberships', 'can_manage_billing', 'false',
  'can_manage_billing defaults to false');

-- Ada: admin_agent in Agency E (inserted as superuser, flag left at its default)
INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000004'::uuid, 'ada@memberships.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');
INSERT INTO users (id, email, full_name) VALUES
  ('dbeef004-0004-4000-a000-000000000004'::uuid, 'ada@memberships.rls', 'Ada Admin');
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef004-0004-4000-a000-000000000004'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'admin_agent');

SELECT is(
  (SELECT can_manage_billing FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid),
  false,
  'a new membership has no billing access by default'
);

-- Server side (superuser / service_role) can grant
UPDATE memberships SET can_manage_billing = true
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid;
SELECT is(
  (SELECT can_manage_billing FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid),
  true,
  'server-side role can grant can_manage_billing'
);
UPDATE memberships SET can_manage_billing = false
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid;

-- Ada tries to self-grant: no UPDATE policy -> RLS filters the row, nothing changes
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
UPDATE memberships SET can_manage_billing = true
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid;
RESET ROLE;
SELECT is(
  (SELECT can_manage_billing FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid),
  false,
  'admin_agent cannot self-grant billing access (no UPDATE policy)'
);

-- Backstop: even if a permissive UPDATE/INSERT policy were added later, the trigger
-- still stops client roles from touching the flag.
CREATE POLICY tmp_memberships_update ON memberships FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY tmp_memberships_insert ON memberships FOR INSERT WITH CHECK (true);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE memberships SET can_manage_billing = true
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid$$,
  '42501',
  'can_manage_billing can only be changed by the server',
  'trigger blocks a client role from changing can_manage_billing even with an UPDATE policy'
);
SELECT throws_ok(
  $$INSERT INTO memberships (user_id, agency_id, role, can_manage_billing)
    VALUES (
      'dbeef004-0004-4000-a000-000000000002'::uuid,
      'c0ffee04-0000-4000-a000-000000000001'::uuid,
      'admin_agent',
      true
    )$$,
  '42501',
  'can_manage_billing can only be set by the server',
  'trigger blocks a client role from inserting a membership with billing access'
);
RESET ROLE;

-- The flag cannot outlive the admin_agent role: demotion clears it
UPDATE memberships SET can_manage_billing = true
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid;
UPDATE memberships SET role = 'agent'
  WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid;
SELECT is(
  (SELECT can_manage_billing FROM memberships
    WHERE user_id = 'dbeef004-0004-4000-a000-000000000004'::uuid),
  false,
  'demoting an admin_agent clears can_manage_billing'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
