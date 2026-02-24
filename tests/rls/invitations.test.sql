-- =============================================================
-- tests/rls/invitations.test.sql
--
-- PRD Policies enforced:
--   invitations_select — Agents/admin_agents/owners can read
--                        invitations for their agency only.
--   invitations_insert — Agents+ can insert invitations for
--                        their agency (with invited_by = self).
--   Talent exclusion   — Talent role cannot read or insert.
--   Cross-agency       — No cross-agency access.
-- =============================================================

BEGIN;
SELECT plan(8);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee05-0000-4000-a000-000000000001'::uuid, 'Invite Agency G', 'rls-invite-agency-g'),
  ('c0ffee05-0000-4000-a000-000000000002'::uuid, 'Invite Agency H', 'rls-invite-agency-h');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef005-0005-4000-a000-000000000001'::uuid, 'agent-g@invitations.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef005-0005-4000-a000-000000000002'::uuid, 'talent-g@invitations.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef005-0005-4000-a000-000000000003'::uuid, 'agent-h@invitations.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef005-0005-4000-a000-000000000001'::uuid, 'agent-g@invitations.rls',  'Agent G'),
  ('dbeef005-0005-4000-a000-000000000002'::uuid, 'talent-g@invitations.rls', 'Talent G'),
  ('dbeef005-0005-4000-a000-000000000003'::uuid, 'agent-h@invitations.rls',  'Agent H');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef005-0005-4000-a000-000000000001'::uuid, 'c0ffee05-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef005-0005-4000-a000-000000000002'::uuid, 'c0ffee05-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef005-0005-4000-a000-000000000003'::uuid, 'c0ffee05-0000-4000-a000-000000000002'::uuid, 'agent');

-- Invitation in Agency G
INSERT INTO invitations (id, agency_id, invited_by, email, role, token_hash, expires_at) VALUES
  ('fade0005-0005-4000-a000-000000000001'::uuid, 'c0ffee05-0000-4000-a000-000000000001'::uuid,
   'dbeef005-0005-4000-a000-000000000001'::uuid, 'newbie@test.com', 'talent',
   'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789', now() + interval '7 days');


-- ── Test 1: invitations_select — agent sees invitations in their agency ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM invitations),
  1,
  'invitations_select: Agent G sees invitation in Agency G'
);


-- ── Test 2: invitations_select — talent cannot see invitations ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM invitations),
  0,
  'invitations_select: Talent G cannot see invitations (agent+ only)'
);


-- ── Test 3: invitations_select — cross-agency isolation ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM invitations),
  0,
  'invitations_select: Agent H cannot see Agency G invitations (cross-agency isolation)'
);


-- ── Test 4: invitations_insert — agent can insert in own agency ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO invitations (id, agency_id, invited_by, email, role, token_hash, expires_at)
    VALUES (
      'fade0005-0005-4000-a000-000000000099'::uuid,
      'c0ffee05-0000-4000-a000-000000000001'::uuid,
      'dbeef005-0005-4000-a000-000000000001'::uuid,
      'another@test.com', 'agent',
      'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
      now() + interval '7 days'
    )$$,
  'invitations_insert: Agent G can insert invitation in Agency G'
);


-- ── Test 5: invitations_insert — talent cannot insert ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO invitations (id, agency_id, invited_by, email, role, token_hash, expires_at)
    VALUES (
      'fade0005-0005-4000-a000-000000000098'::uuid,
      'c0ffee05-0000-4000-a000-000000000001'::uuid,
      'dbeef005-0005-4000-a000-000000000002'::uuid,
      'sneaky@test.com', 'talent',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      now() + interval '7 days'
    )$$,
  '42501',
  'new row violates row-level security policy for table "invitations"',
  'invitations_insert: Talent G cannot insert invitations'
);


-- ── Test 6: invitations_insert — cannot insert for another agency ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO invitations (id, agency_id, invited_by, email, role, token_hash, expires_at)
    VALUES (
      'fade0005-0005-4000-a000-000000000097'::uuid,
      'c0ffee05-0000-4000-a000-000000000001'::uuid,
      'dbeef005-0005-4000-a000-000000000003'::uuid,
      'cross@test.com', 'talent',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      now() + interval '7 days'
    )$$,
  '42501',
  'new row violates row-level security policy for table "invitations"',
  'invitations_insert: Agent H cannot insert invitation in Agency G (cross-agency)'
);

-- ── Test 7: invitations UPDATE blocked for agents (no UPDATE policy — service role only) ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Agent G tries to UPDATE the invitation's accepted_at field.
-- With no UPDATE policy, RLS silently blocks the change (0 rows affected).
UPDATE invitations
   SET accepted_at = now()
 WHERE id = 'fade0005-0005-4000-a000-000000000001'::uuid;

SELECT is(
  (SELECT accepted_at IS NULL FROM invitations WHERE id = 'fade0005-0005-4000-a000-000000000001'::uuid),
  true,
  'invitations UPDATE blocked for agents (no UPDATE policy — service role only)'
);


-- ── Test 8: invitations DELETE blocked for agents (no DELETE policy) ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef005-0005-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Agent G tries to DELETE the invitation.
-- With no DELETE policy, RLS silently blocks the delete (0 rows affected).
DELETE FROM invitations
 WHERE id = 'fade0005-0005-4000-a000-000000000001'::uuid;

SELECT is(
  (SELECT count(*)::int FROM invitations WHERE id = 'fade0005-0005-4000-a000-000000000001'::uuid),
  1,
  'invitations DELETE blocked for agents (no DELETE policy)'
);


RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
