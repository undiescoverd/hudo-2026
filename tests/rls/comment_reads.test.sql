-- =============================================================
-- tests/rls/comment_reads.test.sql
--
-- PRD Policies enforced (migration 0014_comment_reads.sql):
--   comment_reads_select_own — user can only read their own read-markers,
--                              scoped to videos in an agency they belong to.
--   comment_reads_insert_own — user can only insert a read-marker for
--                              themselves (user_id = auth.uid()), and only
--                              for a video in an agency they belong to.
--   comment_reads_update_own — user can only update their own read-marker,
--                              same tenant scope as select/insert.
--   No DELETE policy         — read-markers are not deletable from the API;
--                              any DELETE attempt silently affects 0 rows.
-- =============================================================

BEGIN;
SELECT plan(11);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

-- Two agencies for cross-agency isolation test
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee10-0000-4000-a000-000000000001'::uuid, 'Reads Agency K', 'rls-reads-agency-k'),
  ('c0ffee10-0000-4000-a000-000000000002'::uuid, 'Reads Agency L', 'rls-reads-agency-l');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef010-0010-4000-a000-000000000001'::uuid, 'alice@reads.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef010-0010-4000-a000-000000000002'::uuid, 'toby@reads.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef010-0010-4000-a000-000000000003'::uuid, 'bob@reads.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef010-0010-4000-a000-000000000001'::uuid, 'alice@reads.rls', 'Agent Alice'),
  ('dbeef010-0010-4000-a000-000000000002'::uuid, 'toby@reads.rls',  'Talent Toby'),
  ('dbeef010-0010-4000-a000-000000000003'::uuid, 'bob@reads.rls',   'Agent Bob');

-- Alice + Toby are in Agency K; Bob is in Agency L only (cross-tenant)
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef010-0010-4000-a000-000000000001'::uuid, 'c0ffee10-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef010-0010-4000-a000-000000000002'::uuid, 'c0ffee10-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef010-0010-4000-a000-000000000003'::uuid, 'c0ffee10-0000-4000-a000-000000000002'::uuid, 'agent');

-- One video in Agency K, owned by Toby
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0010-0010-4000-a000-000000000001'::uuid, 'c0ffee10-0000-4000-a000-000000000001'::uuid, 'dbeef010-0010-4000-a000-000000000002'::uuid, 'Toby Showreel');

-- Pre-existing read-marker for Alice on that video
INSERT INTO comment_reads (user_id, video_id, last_seen_at) VALUES
  ('dbeef010-0010-4000-a000-000000000001'::uuid, 'b1de0010-0010-4000-a000-000000000001'::uuid, now() - interval '1 day');


-- ── Test 1: comment_reads_select_own — user sees their own marker ─────
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comment_reads WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid),
  1,
  'comment_reads_select_own: Alice sees her own read-marker'
);


-- ── Test 2: comment_reads_select_own — cannot see another user's marker
-- Toby inserts his own read-marker for the same video (superuser bypass
-- for setup), then Alice must not see it.
RESET ROLE;
INSERT INTO comment_reads (user_id, video_id, last_seen_at) VALUES
  ('dbeef010-0010-4000-a000-000000000002'::uuid, 'b1de0010-0010-4000-a000-000000000001'::uuid, now());

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comment_reads),
  1,
  'comment_reads_select_own: Alice cannot see Toby''s read-marker (own-row isolation)'
);


-- ── Test 3: comment_reads_insert_own — agency member can insert own ───
-- PRD: user can insert their own read-marker for a video in their agency.
RESET ROLE;
DELETE FROM comment_reads WHERE user_id = 'dbeef010-0010-4000-a000-000000000002'::uuid;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO comment_reads (user_id, video_id, last_seen_at)
    VALUES (
      'dbeef010-0010-4000-a000-000000000002'::uuid,
      'b1de0010-0010-4000-a000-000000000001'::uuid,
      now()
    )$$,
  'comment_reads_insert_own: Toby can insert his own read-marker in Agency K'
);


-- ── Test 4: comment_reads_insert_own — cannot insert for another user ──
-- Alice tries to insert a read-marker where user_id != auth.uid().
-- (Toby's row from Test 3 is removed first so this fails on the RLS
-- check, not a primary-key conflict.)
RESET ROLE;
DELETE FROM comment_reads WHERE user_id = 'dbeef010-0010-4000-a000-000000000002'::uuid;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO comment_reads (user_id, video_id, last_seen_at)
    VALUES (
      'dbeef010-0010-4000-a000-000000000002'::uuid,
      'b1de0010-0010-4000-a000-000000000001'::uuid,
      now()
    )$$,
  '42501',
  NULL,
  'comment_reads_insert_own: Alice cannot insert a read-marker for Toby (user_id mismatch)'
);


-- ── Test 5: cross-tenant INSERT blocked ────────────────────────────────
-- Bob (Agency L, not a member of Agency K) tries to insert a read-marker
-- for himself against Agency K's video.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO comment_reads (user_id, video_id, last_seen_at)
    VALUES (
      'dbeef010-0010-4000-a000-000000000003'::uuid,
      'b1de0010-0010-4000-a000-000000000001'::uuid,
      now()
    )$$,
  '42501',
  NULL,
  'comment_reads_insert_own: Bob (cross-agency) cannot insert a read-marker for Agency K video'
);


-- ── Test 6: cross-tenant SELECT blocked even for the user's own row ───
-- Since Bob's INSERT was blocked in Test 5, seed his own row directly
-- as superuser (simulating a data-migration edge case) and verify the
-- SELECT policy still hides it — the membership EXISTS check, not just
-- ownership, is what enforces tenant isolation here.
RESET ROLE;
INSERT INTO comment_reads (user_id, video_id, last_seen_at) VALUES
  ('dbeef010-0010-4000-a000-000000000003'::uuid, 'b1de0010-0010-4000-a000-000000000001'::uuid, now());

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comment_reads
    WHERE user_id = 'dbeef010-0010-4000-a000-000000000003'::uuid
      AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid),
  0,
  'comment_reads_select_own: Bob cannot see even his own read-marker on Agency K video (no membership)'
);


-- ── Test 7: comment_reads_update_own — user can update their own marker
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$UPDATE comment_reads SET last_seen_at = now()
    WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
      AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid$$,
  'comment_reads_update_own: Alice can update her own read-marker'
);


-- ── Test 8: comment_reads_update_own — cannot update another user's ────
-- Toby tries to update Alice's read-marker; RLS silently filters it out
-- (UPDATE ... USING failure = 0 rows affected, no error).
RESET ROLE;
UPDATE comment_reads SET last_seen_at = '2020-01-01'::timestamptz
  WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
    AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid;

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE comment_reads SET last_seen_at = now()
  WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
    AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid;

RESET ROLE;
SELECT is(
  (SELECT last_seen_at FROM comment_reads
    WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
      AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid),
  '2020-01-01'::timestamptz,
  'comment_reads_update_own: Toby cannot update Alice''s read-marker (no-op)'
);


-- ── Test 9: No DELETE policy — hard delete silently blocked ───────────
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef010-0010-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM comment_reads
  WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
    AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid;

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM comment_reads
    WHERE user_id = 'dbeef010-0010-4000-a000-000000000001'::uuid
      AND video_id = 'b1de0010-0010-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: hard delete on comment_reads silently blocked (marker still exists)'
);


-- ── Test 10: no anon policies — unauthenticated sees nothing ──────────
-- PRD: Guests have zero Supabase access; anon role has no policies.
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM comment_reads),
  0,
  'No anon policy: unauthenticated user sees 0 comment_reads rows'
);


-- ── Test 11: anon INSERT blocked ───────────────────────────────────────
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;

SELECT throws_ok(
  $$INSERT INTO comment_reads (user_id, video_id, last_seen_at)
    VALUES (
      'dbeef010-0010-4000-a000-000000000001'::uuid,
      'b1de0010-0010-4000-a000-000000000001'::uuid,
      now()
    )$$,
  '42501',
  NULL,
  'No anon policy: unauthenticated INSERT into comment_reads is blocked'
);


RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
