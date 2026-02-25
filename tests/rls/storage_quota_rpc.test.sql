-- =============================================================
-- tests/rls/storage_quota_rpc.test.sql
--
-- pgTAP tests for increment_storage_usage and decrement_storage_usage RPCs.
-- =============================================================

BEGIN;
SELECT plan(8);

-- ── Setup ──────────────────────────────────────────────────────

INSERT INTO agencies (id, name, slug, storage_usage_bytes, storage_limit_bytes) VALUES
  ('c0ffee08-0000-4000-a000-000000000001'::uuid, 'Quota Test Agency', 'rls-quota-test', 0, 1000);

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef008-0008-4000-a000-000000000001'::uuid, 'quota-user@test.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef008-0008-4000-a000-000000000001'::uuid, 'quota-user@test.rls', 'Quota User');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef008-0008-4000-a000-000000000001'::uuid, 'c0ffee08-0000-4000-a000-000000000001'::uuid, 'agent');

-- Second agency + user for cross-agency test
INSERT INTO agencies (id, name, slug, storage_usage_bytes, storage_limit_bytes) VALUES
  ('c0ffee08-0000-4000-a000-000000000002'::uuid, 'Other Agency', 'rls-quota-other', 0, 1000);

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef008-0008-4000-a000-000000000002'::uuid, 'outsider@test.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef008-0008-4000-a000-000000000002'::uuid, 'outsider@test.rls', 'Outsider');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef008-0008-4000-a000-000000000002'::uuid, 'c0ffee08-0000-4000-a000-000000000002'::uuid, 'agent');


-- ── Test 1: Increment within quota succeeds ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef008-0008-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$SELECT increment_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    500
  )$$,
  'increment_storage_usage: within quota succeeds'
);


-- ── Test 2: Increment exceeding quota raises P0402 ──
SELECT throws_ok(
  $$SELECT increment_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    600
  )$$,
  'P0402',
  'Storage quota exceeded',
  'increment_storage_usage: exceeding quota raises P0402'
);


-- ── Test 3: Decrement works ──
SELECT lives_ok(
  $$SELECT decrement_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    200
  )$$,
  'decrement_storage_usage: decrement works'
);


-- ── Test 4: Decrement floors at 0 ──
SELECT lives_ok(
  $$SELECT decrement_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    999999
  )$$,
  'decrement_storage_usage: floors at 0 (no underflow)'
);


-- ── Test 5: Unauthenticated increment fails ──
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT increment_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    100
  )$$,
  '42501',
  'Authentication required',
  'increment_storage_usage: unauthenticated call fails'
);


-- ── Test 6: Unauthenticated decrement fails ──
SELECT throws_ok(
  $$SELECT decrement_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    100
  )$$,
  '42501',
  'Authentication required',
  'decrement_storage_usage: unauthenticated call fails'
);


-- ── Test 7: Non-member cannot increment another agency's quota ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef008-0008-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT increment_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    100
  )$$,
  '42501',
  'Access denied: not a member of this agency',
  'increment_storage_usage: non-member access blocked'
);


-- ── Test 8: Non-member cannot decrement another agency's quota ──
SELECT throws_ok(
  $$SELECT decrement_storage_usage(
    'c0ffee08-0000-4000-a000-000000000001'::uuid,
    100
  )$$,
  '42501',
  'Access denied: not a member of this agency',
  'decrement_storage_usage: non-member access blocked'
);


RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
