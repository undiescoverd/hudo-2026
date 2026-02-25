-- =============================================================
-- tests/rls/notification_preferences.test.sql
--
-- PRD Policies enforced:
--   notification_prefs_select — Users can only read their own.
--   notification_prefs_update — Users can update their own only.
--   notification_prefs_insert — Users can insert their own only.
--   Cross-user isolation     — Cannot access others' preferences.
-- =============================================================

BEGIN;
SELECT plan(4);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee09-0000-4000-a000-000000000001'::uuid, 'Prefs Agency N', 'rls-prefs-agency-n');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef009-0009-4000-a000-000000000001'::uuid, 'oscar@prefs.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef009-0009-4000-a000-000000000002'::uuid, 'petra@prefs.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef009-0009-4000-a000-000000000001'::uuid, 'oscar@prefs.rls', 'Oscar Agent'),
  ('dbeef009-0009-4000-a000-000000000002'::uuid, 'petra@prefs.rls', 'Petra Agent');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef009-0009-4000-a000-000000000001'::uuid, 'c0ffee09-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef009-0009-4000-a000-000000000002'::uuid, 'c0ffee09-0000-4000-a000-000000000001'::uuid, 'agent');

-- Oscar has preferences; Petra does not yet
INSERT INTO notification_preferences (user_id, email_enabled, batch_window_minutes) VALUES
  ('dbeef009-0009-4000-a000-000000000001'::uuid, true, 15);


-- ── Test 1: notification_prefs_select — user sees only their own ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef009-0009-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM notification_preferences),
  1,
  'notification_prefs_select: Oscar sees his own preferences'
);


-- ── Test 2: notification_prefs_select — cannot see other user prefs ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef009-0009-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM notification_preferences),
  0,
  'notification_prefs_select: Petra cannot see Oscar preferences'
);


-- ── Test 3: notification_prefs_insert — user can insert own prefs ──
SELECT lives_ok(
  $$INSERT INTO notification_preferences (user_id, email_enabled, batch_window_minutes)
    VALUES ('dbeef009-0009-4000-a000-000000000002'::uuid, false, 30)$$,
  'notification_prefs_insert: Petra can insert her own preferences'
);


-- ── Test 4: notification_prefs_update — user can update own prefs ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef009-0009-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE notification_preferences SET email_enabled = false
    WHERE user_id = 'dbeef009-0009-4000-a000-000000000001'::uuid$$,
  'notification_prefs_update: Oscar can update his own preferences'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
