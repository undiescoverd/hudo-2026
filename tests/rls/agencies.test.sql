-- =============================================================
-- tests/rls/agencies.test.sql
--
-- PRD Policies enforced:
--   agency_select       — Members can only read agencies they belong to;
--                         cross-agency read access is impossible.
--   agency_update_owner — Only owners can update their own agency;
--                         agents and members of other agencies cannot.
-- =============================================================

BEGIN;
SELECT plan(6);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee01-0000-4000-a000-000000000001'::uuid, 'Agency Alpha', 'rls-test-alpha'),
  ('c0ffee01-0000-4000-a000-000000000002'::uuid, 'Agency Beta',  'rls-test-beta');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef001-0001-4000-a000-000000000001'::uuid, 'alpha@agencies.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef001-0001-4000-a000-000000000002'::uuid, 'beta@agencies.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef001-0001-4000-a000-000000000001'::uuid, 'alpha@agencies.rls', 'Alpha User'),
  ('dbeef001-0001-4000-a000-000000000002'::uuid, 'beta@agencies.rls',  'Beta User');

-- Alpha = agent in Agency Alpha; Beta = owner in Agency Beta
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef001-0001-4000-a000-000000000001'::uuid, 'c0ffee01-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef001-0001-4000-a000-000000000002'::uuid, 'c0ffee01-0000-4000-a000-000000000002'::uuid, 'owner');


-- ── Test 1: agency_select — member sees only their own agency ────────
-- PRD: Multi-tenancy via memberships; cross-agency read is impossible.

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef001-0001-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM agencies),
  1,
  'agency_select: Alpha agent sees exactly 1 agency'
);


-- ── Test 2: agency_select — correct agency ID returned ───────────────
SELECT is(
  (SELECT id FROM agencies LIMIT 1),
  'c0ffee01-0000-4000-a000-000000000001'::uuid,
  'agency_select: Alpha agent sees only Agency Alpha, not Agency Beta'
);


-- ── Test 3: agency_select — cross-agency read returns empty set ───────
-- PRD: Cross-agency data access is impossible.
SELECT is(
  (SELECT count(*)::int FROM agencies
    WHERE id = 'c0ffee01-0000-4000-a000-000000000002'::uuid),
  0,
  'agency_select: Alpha agent cannot read Agency Beta (cross-agency isolation)'
);


-- ── Test 4: agency_update_owner — owner can update their own agency ───
-- PRD: Only owners can update their agency record.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef001-0001-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE agencies
   SET name = 'Agency Beta (Updated)'
 WHERE id = 'c0ffee01-0000-4000-a000-000000000002'::uuid;

SELECT is(
  (SELECT name FROM agencies WHERE id = 'c0ffee01-0000-4000-a000-000000000002'::uuid),
  'Agency Beta (Updated)',
  'agency_update_owner: Owner can update their own agency'
);


-- ── Test 5: agency_update_owner — agent in other agency cannot update ─
-- PRD: Cross-agency modification is impossible.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef001-0001-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE agencies SET name = 'Hacked'
 WHERE id = 'c0ffee01-0000-4000-a000-000000000002'::uuid;

-- Verify as superuser that Agency Beta name was NOT changed
RESET ROLE;
SELECT is(
  (SELECT name FROM agencies WHERE id = 'c0ffee01-0000-4000-a000-000000000002'::uuid),
  'Agency Beta (Updated)',
  'agency_update_owner: Agent in Agency Alpha cannot update Agency Beta'
);


-- ── Test 6: no anon policies — unauthenticated sees nothing ──────────
-- PRD: Guests have zero Supabase access; anon role has no policies.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM agencies),
  0,
  'No anon policy: unauthenticated user sees 0 agencies'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
