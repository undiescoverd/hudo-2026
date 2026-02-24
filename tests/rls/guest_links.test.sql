-- =============================================================
-- tests/rls/guest_links.test.sql
--
-- PRD Policies enforced:
--   guest_links_select — Agents/admin_agents/owners can read
--                        guest links for their agency.
--   guest_links_insert — Agents+ can create guest links
--                        (created_by = self).
--   guest_links_update — Agents+ can update (revoke) guest links.
--   Talent exclusion   — Talent role has no access.
--   Cross-agency       — No cross-agency access.
-- =============================================================

BEGIN;
SELECT plan(7);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee06-0000-4000-a000-000000000001'::uuid, 'Guest Agency I', 'rls-guest-agency-i'),
  ('c0ffee06-0000-4000-a000-000000000002'::uuid, 'Guest Agency J', 'rls-guest-agency-j');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef006-0006-4000-a000-000000000001'::uuid, 'agent-i@guests.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef006-0006-4000-a000-000000000002'::uuid, 'talent-i@guests.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef006-0006-4000-a000-000000000003'::uuid, 'agent-j@guests.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef006-0006-4000-a000-000000000001'::uuid, 'agent-i@guests.rls',  'Agent I'),
  ('dbeef006-0006-4000-a000-000000000002'::uuid, 'talent-i@guests.rls', 'Talent I'),
  ('dbeef006-0006-4000-a000-000000000003'::uuid, 'agent-j@guests.rls',  'Agent J');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef006-0006-4000-a000-000000000001'::uuid, 'c0ffee06-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef006-0006-4000-a000-000000000002'::uuid, 'c0ffee06-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef006-0006-4000-a000-000000000003'::uuid, 'c0ffee06-0000-4000-a000-000000000002'::uuid, 'agent');

-- Video (needed for FK chain: guest_links -> videos)
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0006-0006-4000-a000-000000000001'::uuid, 'c0ffee06-0000-4000-a000-000000000001'::uuid, 'dbeef006-0006-4000-a000-000000000002'::uuid, 'Talent I Showreel');

-- Guest link in Agency I
INSERT INTO guest_links (id, video_id, agency_id, token_hash, created_by) VALUES
  ('dead0006-0006-4000-a000-000000000001'::uuid,
   'b1de0006-0006-4000-a000-000000000001'::uuid,
   'c0ffee06-0000-4000-a000-000000000001'::uuid,
   'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
   'dbeef006-0006-4000-a000-000000000001'::uuid);


-- ── Test 1: guest_links_select — agent sees guest links in their agency ──
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM guest_links),
  1,
  'guest_links_select: Agent I sees guest link in Agency I'
);


-- ── Test 2: guest_links_select — talent cannot see guest links ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM guest_links),
  0,
  'guest_links_select: Talent I cannot see guest links (agent+ only)'
);


-- ── Test 3: guest_links_select — cross-agency isolation ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM guest_links),
  0,
  'guest_links_select: Agent J cannot see Agency I guest links (cross-agency isolation)'
);


-- ── Test 4: guest_links_insert — agent can create guest link ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO guest_links (id, video_id, agency_id, token_hash, created_by)
    VALUES (
      'dead0006-0006-4000-a000-000000000099'::uuid,
      'b1de0006-0006-4000-a000-000000000001'::uuid,
      'c0ffee06-0000-4000-a000-000000000001'::uuid,
      'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'dbeef006-0006-4000-a000-000000000001'::uuid
    )$$,
  'guest_links_insert: Agent I can create guest link in Agency I'
);


-- ── Test 5: guest_links_update — agent can revoke (update) guest link ──
SELECT lives_ok(
  $$UPDATE guest_links SET revoked_at = now()
    WHERE id = 'dead0006-0006-4000-a000-000000000001'::uuid$$,
  'guest_links_update: Agent I can revoke guest link in Agency I'
);


-- ── Test 6: guest_links_insert — talent cannot create guest links ──
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO guest_links (id, video_id, agency_id, token_hash, created_by)
    VALUES (
      'dead0006-0006-4000-a000-000000000098'::uuid,
      'b1de0006-0006-4000-a000-000000000001'::uuid,
      'c0ffee06-0000-4000-a000-000000000001'::uuid,
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'dbeef006-0006-4000-a000-000000000002'::uuid
    )$$,
  '42501',
  'new row violates row-level security policy for table "guest_links"',
  'guest_links_insert: Talent I cannot create guest links'
);

-- ── Test 7: No DELETE policy — hard delete silently affects 0 rows ──
-- No DELETE policy exists on guest_links; hard DELETE is intentionally
-- forbidden. RLS silently blocks the operation (0 rows affected).
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef006-0006-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM guest_links WHERE id = 'dead0006-0006-4000-a000-000000000001'::uuid;

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM guest_links
    WHERE id = 'dead0006-0006-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: hard delete on guest_links silently blocked (link still exists)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
