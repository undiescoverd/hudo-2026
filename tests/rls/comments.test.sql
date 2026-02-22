-- =============================================================
-- tests/rls/comments.test.sql
--
-- PRD Policies enforced:
--   comments_select      — All agency members can read non-deleted
--                          comments; cross-agency read is blocked.
--   comments_insert      — Any authenticated agency member can insert
--                          a comment (user_id = auth.uid()).
--   comments_update_own  — Users can soft-delete (deleted_at) or edit
--                          their own comments.
--   No DELETE policy     — Hard delete is forbidden; only soft-delete
--                          via UPDATE is permitted. Any DELETE attempt
--                          silently affects 0 rows.
-- =============================================================

BEGIN;
SELECT plan(6);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

-- Two agencies for cross-agency isolation test
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee03-0000-4000-a000-000000000001'::uuid, 'Comment Agency C', 'rls-comment-agency-c'),
  ('c0ffee03-0000-4000-a000-000000000002'::uuid, 'Comment Agency D', 'rls-comment-agency-d');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'charlie@comments.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'clara@comments.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000003'::uuid, 'dave@comments.rls',    'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000004'::uuid, 'diana@comments.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef003-0003-4000-a000-000000000001'::uuid, 'charlie@comments.rls', 'Agent Charlie'),
  ('dbeef003-0003-4000-a000-000000000002'::uuid, 'clara@comments.rls',   'Talent Clara'),
  ('dbeef003-0003-4000-a000-000000000003'::uuid, 'dave@comments.rls',    'Agent Dave'),
  ('dbeef003-0003-4000-a000-000000000004'::uuid, 'diana@comments.rls',   'Talent Diana');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'agent'),
  ('dbeef003-0003-4000-a000-000000000004'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'talent');

-- Videos (needed for FK chain: comments -> video_versions -> videos)
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'Clara Showreel'),
  ('b1de0003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'dbeef003-0003-4000-a000-000000000004'::uuid, 'Diana Showreel');

-- Video versions
INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('bee00003-0003-4000-a000-000000000001'::uuid, 'b1de0003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 1, 'agency-c/clara-v1.mp4', 100000000, 'dbeef003-0003-4000-a000-000000000001'::uuid),
  ('bee00003-0003-4000-a000-000000000002'::uuid, 'b1de0003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 1, 'agency-d/diana-v1.mp4', 100000000, 'dbeef003-0003-4000-a000-000000000003'::uuid);

-- Two comments in Agency C (by Charlie and Clara); one in Agency D (by Dave)
INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds) VALUES
  ('c0de0003-0003-4000-a000-000000000001'::uuid, 'bee00003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'Great intro!', 'point', 5.0),
  ('c0de0003-0003-4000-a000-000000000002'::uuid, 'bee00003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'Check the lighting here.', 'point', 12.5),
  ('c0de0003-0003-4000-a000-000000000003'::uuid, 'bee00003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'dbeef003-0003-4000-a000-000000000003'::uuid, 'Agency D comment.', 'point', 3.0);


-- ── Test 1: comments_select — agent sees all agency comments ──────────
-- PRD: All agency members can read comments in their agency.

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments),
  2,
  'comments_select: Agent Charlie sees both comments in Agency C'
);


-- ── Test 2: comments_select — talent sees all agency comments ─────────
-- PRD: All agency members (not just agents) can read comments.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments),
  2,
  'comments_select: Talent Clara sees both comments in Agency C'
);


-- ── Test 3: comments_select — cross-agency read blocked ───────────────
-- PRD: Cross-agency data access is impossible.
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000003'::uuid),
  0,
  'comments_select: Clara cannot read Agency D comment (cross-agency isolation)'
);


-- ── Test 4: comments_insert — agency member can insert a comment ───────
-- PRD: Any authenticated agency member can post a comment.
SELECT lives_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds)
    VALUES (
      'c0de0003-0003-4000-a000-000000000099'::uuid,
      'bee00003-0003-4000-a000-000000000001'::uuid,
      'c0ffee03-0000-4000-a000-000000000001'::uuid,
      'dbeef003-0003-4000-a000-000000000002'::uuid,
      'New comment from Clara.',
      'point',
      20.0
    )$$,
  'comments_insert: Talent Clara can insert a comment in Agency C'
);


-- ── Test 5: comments_update_own — user can soft-delete their own comment
-- PRD: Comments soft-delete only (deleted_at). No hard delete via any API.
SELECT lives_ok(
  $$UPDATE comments
       SET deleted_at = now()
     WHERE id = 'c0de0003-0003-4000-a000-000000000002'::uuid$$,
  'comments_update_own: Clara can soft-delete her own comment (set deleted_at)'
);


-- ── Test 6: No DELETE policy — hard delete silently affects 0 rows ────
-- PRD: Comments soft-delete only. No hard delete via any API endpoint.
--      Without a DELETE policy, RLS silently blocks the operation.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

DELETE FROM comments WHERE id = 'c0de0003-0003-4000-a000-000000000001'::uuid;

-- Comment C1 must still exist (DELETE was a no-op due to no DELETE policy)
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: hard delete on comments silently blocked (comment still exists)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
