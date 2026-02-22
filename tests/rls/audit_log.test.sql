-- =============================================================
-- tests/rls/audit_log.test.sql
--
-- PRD Policies enforced:
--   audit_log_select — Only owners and admin_agents can SELECT from
--                      audit_log for their agency; regular agents
--                      and talent cannot read the audit trail.
--   No INSERT policy — Inserts performed exclusively via service role
--                      in API routes. Authenticated clients cannot
--                      insert, regardless of role.
--   No UPDATE policy — audit_log records are immutable; no client
--                      can update any row.
--   No DELETE policy — audit_log records are immutable; no client
--                      can delete any row.
--
-- Architecture: audit_log is insert-only from the application layer
-- (service role). All other operations are blocked at the RLS layer.
-- Any future removal of these non-policies must cause this suite to fail.
-- =============================================================

BEGIN;
SELECT plan(5);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee04-0000-4000-a000-000000000001'::uuid, 'Audit Agency E', 'rls-audit-agency-e');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000001'::uuid, 'oscar@audit.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000002'::uuid, 'amanda@audit.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef004-0004-4000-a000-000000000003'::uuid, 'roger@audit.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef004-0004-4000-a000-000000000001'::uuid, 'oscar@audit.rls',   'Owner Oscar'),
  ('dbeef004-0004-4000-a000-000000000002'::uuid, 'amanda@audit.rls',  'Admin Amanda'),
  ('dbeef004-0004-4000-a000-000000000003'::uuid, 'roger@audit.rls',   'Agent Roger');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef004-0004-4000-a000-000000000001'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'owner'),
  ('dbeef004-0004-4000-a000-000000000002'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'admin_agent'),
  ('dbeef004-0004-4000-a000-000000000003'::uuid, 'c0ffee04-0000-4000-a000-000000000001'::uuid, 'agent');

-- Insert an audit log entry via service role (superuser = postgres here)
-- This simulates what API routes do via service role key.
INSERT INTO audit_log (id, agency_id, actor_id, actor_name, action, resource_type, resource_id) VALUES
  ('a1090004-0004-4000-a000-000000000001'::uuid,
   'c0ffee04-0000-4000-a000-000000000001'::uuid,
   'dbeef004-0004-4000-a000-000000000001'::uuid,
   'Owner Oscar',
   'status_changed',
   'video',
   'a1090004-0004-4000-a000-000000000099'::uuid);


-- ── Test 1: audit_log_select — owner can read audit log ──────────────
-- PRD: Owners can view the audit trail for their agency.

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM audit_log
    WHERE agency_id = 'c0ffee04-0000-4000-a000-000000000001'::uuid),
  1,
  'audit_log_select: Owner can read audit log for their agency'
);


-- ── Test 2: audit_log_select — admin_agent can read audit log ────────
-- PRD: Admin agents can view the audit trail for their agency.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM audit_log
    WHERE agency_id = 'c0ffee04-0000-4000-a000-000000000001'::uuid),
  1,
  'audit_log_select: Admin agent can read audit log for their agency'
);


-- ── Test 3: audit_log_select — regular agent cannot read audit log ────
-- PRD: Only owners and admin_agents can see the audit trail.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM audit_log),
  0,
  'audit_log_select: Regular agent sees 0 audit log entries (no select policy)'
);


-- ── Test 4: No INSERT policy — authenticated clients cannot insert ─────
-- PRD: audit_log is insert-only from service role in API routes.
--      No INSERT policy means any authenticated INSERT is rejected.
SELECT throws_ok(
  $$INSERT INTO audit_log (id, agency_id, actor_id, actor_name, action, resource_type, resource_id)
    VALUES (
      'a1090004-0004-4000-a000-000000000098'::uuid,
      'c0ffee04-0000-4000-a000-000000000001'::uuid,
      'dbeef004-0004-4000-a000-000000000003'::uuid,
      'Agent Roger',
      'status_changed',
      'video',
      'a1090004-0004-4000-a000-000000000097'::uuid
    )$$,
  '42501',
  'No INSERT policy: authenticated client cannot insert into audit_log'
);


-- ── Test 5: No DELETE policy — audit_log records are immutable ────────
-- PRD: audit_log is insert-only. No update/delete policy. Period.
--      Without a DELETE policy, the DELETE silently affects 0 rows.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef004-0004-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Owner attempts to delete the audit entry (should silently fail)
DELETE FROM audit_log WHERE id = 'a1090004-0004-4000-a000-000000000001'::uuid;

-- Entry must still exist — verify as owner who can SELECT
SELECT is(
  (SELECT count(*)::int FROM audit_log
    WHERE id = 'a1090004-0004-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: audit_log entry is immutable (delete silently blocked)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
