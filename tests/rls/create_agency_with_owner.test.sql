-- =============================================================
-- tests/rls/create_agency_with_owner.test.sql
--
-- pgTAP tests for create_agency_with_owner RPC (S4-JOURNEY-001).
-- =============================================================

BEGIN;
SELECT plan(11);

-- ── Test 1-3: service_role can execute; creates users + agency + owner membership ──
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$SELECT create_agency_with_owner(
    'dbeef027-0027-4000-a000-000000000001'::uuid,
    'Owner@Signup.RLS',
    'Sign Up Owner',
    'Signup Test Agency',
    'rls-signup-test-agency'
  )$$,
  'service_role can execute create_agency_with_owner'
);

SELECT is(
  (SELECT count(*)::int FROM public.users
    WHERE id = 'dbeef027-0027-4000-a000-000000000001'::uuid
      AND email = 'owner@signup.rls' AND full_name = 'Sign Up Owner'),
  1,
  'creates the users row (email lower-cased)'
);

SELECT is(
  (SELECT count(*)::int
     FROM public.memberships m
     JOIN public.agencies a ON a.id = m.agency_id
    WHERE m.user_id = 'dbeef027-0027-4000-a000-000000000001'::uuid
      AND m.role = 'owner'
      AND a.slug = 'rls-signup-test-agency'
      AND a.name = 'Signup Test Agency'),
  1,
  'creates the agency and the owner membership'
);

-- ── Test 4: new agency is plain freemium ──
SELECT is(
  (SELECT plan || ':' || is_founding_member::text FROM public.agencies
    WHERE slug = 'rls-signup-test-agency'),
  'freemium:false',
  'agency is freemium and not a founding member'
);

-- ── Test 5: duplicate slug raises unique_violation ──
SELECT throws_ok(
  $$SELECT create_agency_with_owner(
    'dbeef027-0027-4000-a000-000000000002'::uuid,
    'second@signup.rls',
    'Second Owner',
    'Signup Test Agency',
    'rls-signup-test-agency'
  )$$,
  '23505',
  NULL,
  'duplicate slug raises unique_violation'
);

-- ── Test 6: failed call leaves nothing partial (users row from the failed call absent) ──
SELECT is(
  (SELECT count(*)::int FROM public.users
    WHERE id = 'dbeef027-0027-4000-a000-000000000002'::uuid),
  0,
  'failed call leaves no users row behind'
);

-- ── Test 7: failure after the users insert (agency step) is atomic via subtransaction ──
-- A blank slug is rejected up front; no rows are written.
SELECT throws_ok(
  $$SELECT create_agency_with_owner(
    'dbeef027-0027-4000-a000-000000000003'::uuid,
    'third@signup.rls',
    'Third Owner',
    'Blank Slug Agency',
    '   '
  )$$,
  '22023',
  'agency name and slug are required',
  'blank slug is rejected'
);

SELECT is(
  (SELECT count(*)::int FROM public.users
    WHERE id = 'dbeef027-0027-4000-a000-000000000003'::uuid)
  + (SELECT count(*)::int FROM public.agencies WHERE name = 'Blank Slug Agency'),
  0,
  'blank-slug rejection writes nothing'
);

-- ── Test 9: authenticated cannot execute ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef027-0027-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$SELECT create_agency_with_owner(
    'dbeef027-0027-4000-a000-000000000004'::uuid,
    'auth@signup.rls', 'Auth User', 'Auth Agency', 'rls-signup-auth-agency'
  )$$,
  '42501',
  NULL,
  'authenticated cannot execute create_agency_with_owner'
);

-- ── Test 10: anon cannot execute ──
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$SELECT create_agency_with_owner(
    'dbeef027-0027-4000-a000-000000000005'::uuid,
    'anon@signup.rls', 'Anon User', 'Anon Agency', 'rls-signup-anon-agency'
  )$$,
  '42501',
  NULL,
  'anon cannot execute create_agency_with_owner'
);

-- ── Test 11: PUBLIC has no EXECUTE grant ──
RESET ROLE;
SELECT is(
  has_function_privilege('public',
    'public.create_agency_with_owner(uuid,text,text,text,text)', 'EXECUTE'),
  false,
  'PUBLIC has no EXECUTE on create_agency_with_owner'
);

SELECT * FROM finish();
ROLLBACK;
