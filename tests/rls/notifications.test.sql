-- =============================================================
-- tests/rls/notifications.test.sql
--
-- PRD Policies enforced:
--   notifications_select     — Users can only read their own.
--   notifications_update_own — Users can update (mark as read)
--                              their own notifications only.
--   Cross-user isolation     — Cannot read/update others' notifications.
-- =============================================================

BEGIN;
SELECT plan(4);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee08-0000-4000-a000-000000000001'::uuid, 'Notif Agency M', 'rls-notif-agency-m');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef008-0008-4000-a000-000000000001'::uuid, 'mike@notifications.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef008-0008-4000-a000-000000000002'::uuid, 'nina@notifications.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef008-0008-4000-a000-000000000001'::uuid, 'mike@notifications.rls', 'Mike Agent'),
  ('dbeef008-0008-4000-a000-000000000002'::uuid, 'nina@notifications.rls', 'Nina Agent');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef008-0008-4000-a000-000000000001'::uuid, 'c0ffee08-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef008-0008-4000-a000-000000000002'::uuid, 'c0ffee08-0000-4000-a000-000000000001'::uuid, 'agent');

-- Notifications: one for Mike, one for Nina
INSERT INTO notifications (id, agency_id, recipient_id, type) VALUES
  ('face0008-0008-4000-a000-000000000001'::uuid, 'c0ffee08-0000-4000-a000-000000000001'::uuid, 'dbeef008-0008-4000-a000-000000000001'::uuid, 'new_comment'),
  ('face0008-0008-4000-a000-000000000002'::uuid, 'c0ffee08-0000-4000-a000-000000000001'::uuid, 'dbeef008-0008-4000-a000-000000000002'::uuid, 'status_changed');


-- ── Test 1: notifications_select — user sees only their own ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef008-0008-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM notifications),
  1,
  'notifications_select: Mike sees only his own notification'
);


-- ── Test 2: notifications_select — cannot see other user notifications ──
SELECT is(
  (SELECT count(*)::int FROM notifications
    WHERE id = 'face0008-0008-4000-a000-000000000002'::uuid),
  0,
  'notifications_select: Mike cannot see Nina notification'
);


-- ── Test 3: notifications_update_own — user can mark own as read ──
SELECT lives_ok(
  $$UPDATE notifications SET read_at = now()
    WHERE id = 'face0008-0008-4000-a000-000000000001'::uuid$$,
  'notifications_update_own: Mike can mark his own notification as read'
);


-- ── Test 4: notifications_update_own — cannot update others ──
UPDATE notifications SET read_at = now()
  WHERE id = 'face0008-0008-4000-a000-000000000002'::uuid;

-- Verify as superuser that Nina's notification was NOT updated
RESET ROLE;
SELECT is(
  (SELECT read_at IS NULL FROM notifications
    WHERE id = 'face0008-0008-4000-a000-000000000002'::uuid),
  true,
  'notifications_update_own: Mike cannot mark Nina notification as read'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
