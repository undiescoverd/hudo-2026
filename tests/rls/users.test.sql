-- =============================================================
-- tests/rls/users.test.sql
--
-- PRD Policies enforced (migration 0002_rls_policies.sql):
--   users_select_self   — a user can always read their own row.
--   users_select_agency — a user can read the rows of any user who
--                        shares at least one agency with them, via
--                        the `memberships` join table (never an
--                        `agency_id` column on `users` — a user can
--                        belong to multiple agencies).
--   users_update_self   — a user can update only their own row.
--   No INSERT policy    — users are created via service role during
--                        registration/invitation, never directly by
--                        an authenticated client; any attempt errors.
--   No DELETE policy    — users cannot be deleted via the API; any
--                        DELETE attempt silently affects 0 rows.
-- =============================================================

BEGIN;
SELECT plan(11);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

-- Two agencies for cross-agency isolation test
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee11-0000-4000-a000-000000000001'::uuid, 'Users Agency K', 'rls-users-agency-k'),
  ('c0ffee11-0000-4000-a000-000000000002'::uuid, 'Users Agency L', 'rls-users-agency-l');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef011-0011-4000-a000-000000000001'::uuid, 'alice@users.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef011-0011-4000-a000-000000000002'::uuid, 'toby@users.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef011-0011-4000-a000-000000000003'::uuid, 'bob@users.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef011-0011-4000-a000-000000000004'::uuid, 'multi@users.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef011-0011-4000-a000-000000000005'::uuid, 'nina@users.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef011-0011-4000-a000-000000000001'::uuid, 'alice@users.rls', 'Agent Alice'),
  ('dbeef011-0011-4000-a000-000000000002'::uuid, 'toby@users.rls',  'Talent Toby'),
  ('dbeef011-0011-4000-a000-000000000003'::uuid, 'bob@users.rls',   'Agent Bob'),
  ('dbeef011-0011-4000-a000-000000000004'::uuid, 'multi@users.rls', 'Multi-Agency Mel'),
  ('dbeef011-0011-4000-a000-000000000005'::uuid, 'nina@users.rls',  'No-Agency Nina');

-- Nina has NO membership row anywhere — she exists to isolate
-- users_select_self from users_select_agency (see Test 11).

-- Alice + Toby are in Agency K only; Bob is in Agency L only;
-- Mel belongs to BOTH agencies (multi-tenancy: a user can belong to
-- multiple agencies via `memberships`, never a single agency_id column).
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef011-0011-4000-a000-000000000001'::uuid, 'c0ffee11-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef011-0011-4000-a000-000000000002'::uuid, 'c0ffee11-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef011-0011-4000-a000-000000000003'::uuid, 'c0ffee11-0000-4000-a000-000000000002'::uuid, 'agent'),
  ('dbeef011-0011-4000-a000-000000000004'::uuid, 'c0ffee11-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef011-0011-4000-a000-000000000004'::uuid, 'c0ffee11-0000-4000-a000-000000000002'::uuid, 'agent');


-- ── Test 1: users_select_self — a user always sees their own row ──────
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef011-0011-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM users WHERE id = 'dbeef011-0011-4000-a000-000000000001'::uuid),
  1,
  'users_select_self: Alice sees her own row'
);


-- ── Test 2: users_select_agency — sees agency-mates via memberships ───
-- PRD: agency context is derived from `memberships`, never a column on
-- `users`. Alice (Agency K) should see herself, Toby, and Mel (all in K).
SELECT is(
  (SELECT count(*)::int FROM users),
  3,
  'users_select_agency: Alice sees all Agency K members (self + Toby + Mel)'
);


-- ── Test 3: cross-agency SELECT blocked ────────────────────────────────
-- Bob is only in Agency L, so Alice (Agency K only) must not see him.
SELECT is(
  (SELECT count(*)::int FROM users WHERE id = 'dbeef011-0011-4000-a000-000000000003'::uuid),
  0,
  'users_select_agency: Alice cannot see Bob (no shared agency)'
);


-- ── Test 4: multi-agency membership sees users across both agencies ───
-- PRD: a user can belong to multiple agencies. Mel is in both K and L,
-- so she should see all four users (Alice, Toby, Bob, herself).
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef011-0011-4000-a000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM users),
  4,
  'users_select_agency: Mel (member of both K and L) sees users from both agencies'
);


-- ── Test 5: users_update_self — a user can update their own row ───────
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef011-0011-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE users SET full_name = 'Agent Alice (Updated)'
    WHERE id = 'dbeef011-0011-4000-a000-000000000001'::uuid$$,
  'users_update_self: Alice can update her own full_name'
);


-- ── Test 6: cannot update another user's row ──────────────────────────
-- Alice tries to update Toby's row (same agency, but not her own row).
-- RLS silently filters it out (UPDATE ... USING failure = 0 rows, no error).
UPDATE users SET full_name = 'Hacked!'
  WHERE id = 'dbeef011-0011-4000-a000-000000000002'::uuid;

RESET ROLE;
SELECT is(
  (SELECT full_name FROM users WHERE id = 'dbeef011-0011-4000-a000-000000000002'::uuid),
  'Talent Toby',
  'users_update_self: Alice cannot update Toby''s row (own-row only)'
);


-- ── Test 7: No INSERT policy — direct client insert blocked ──────────
-- PRD: users are created via service role during registration/invitation
-- flows only; no client-facing INSERT policy exists.
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef011-0011-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO users (id, email, full_name)
    VALUES (
      'dbeef011-0011-4000-a000-000000000099'::uuid,
      'newuser@users.rls',
      'Direct Insert Attempt'
    )$$,
  '42501',
  NULL,
  'No INSERT policy: authenticated client cannot directly insert into users'
);


-- ── Test 8: No DELETE policy — hard delete silently blocked ──────────
DELETE FROM users WHERE id = 'dbeef011-0011-4000-a000-000000000001'::uuid;

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM users WHERE id = 'dbeef011-0011-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: hard delete on users silently blocked (row still exists)'
);


-- ── Test 9: no anon policies — unauthenticated sees nothing ──────────
-- PRD: Guests have zero Supabase access; anon role has no policies.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM users),
  0,
  'No anon policy: unauthenticated user sees 0 users (PII protected)'
);


-- ── Test 10: anon INSERT blocked ──────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO users (id, email, full_name)
    VALUES (
      'dbeef011-0011-4000-a000-000000000098'::uuid,
      'anon@users.rls',
      'Anon Insert Attempt'
    )$$,
  '42501',
  NULL,
  'No anon policy: unauthenticated INSERT into users is blocked'
);


-- ── Test 11: users_select_self isolated from users_select_agency ──────
-- Nina has zero memberships, so users_select_agency's membership subquery
-- returns an empty set for her — if she can still see her own row, it's
-- purely users_select_self doing the work, not agency overlap.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef011-0011-4000-a000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM users),
  1,
  'users_select_self: Nina (no memberships) sees exactly her own row, no one else''s'
);


RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
