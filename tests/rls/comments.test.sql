-- =============================================================
-- tests/rls/comments.test.sql
--
-- PRD Policies enforced:
--   comments_select      — Agents and above (owner, admin_agent, agent) read
--                          every comment in their agency. Talent read only
--                          comments on videos they own (videos.talent_id =
--                          auth.uid()), matching videos_select_talent /
--                          video_versions_select. Soft-deleted rows stay
--                          visible to whoever can see the video (Realtime
--                          must deliver soft-delete UPDATEs; the API filters
--                          deleted_at in code; #187, migrations 0029 and
--                          0030). Cross-agency read is blocked.
--   prevent_comment_undelete — BEFORE UPDATE trigger (migration 0030): a
--                          soft-deleted comment cannot be restored
--                          (deleted_at non-null -> null raises 23514) for any
--                          role. Soft-deleting (null -> timestamp) still works.
--   comments_insert      — Any authenticated agency member can insert
--                          a comment (user_id = auth.uid()).
--   comments_update_own  — Users can soft-delete (deleted_at) or edit
--                          their own comments.
--   No DELETE policy     — Hard delete is forbidden; only soft-delete
--                          via UPDATE is permitted. Any DELETE attempt
--                          silently affects 0 rows.
--
-- Test N below is the Nth pgTAP assertion (matches the "ok N" TAP line).
-- =============================================================

BEGIN;
SELECT plan(23);

-- ── Setup (runs as postgres superuser) ──────────────────────────────

-- Two agencies for cross-agency isolation test
INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee03-0000-4000-a000-000000000001'::uuid, 'Comment Agency C', 'rls-comment-agency-c'),
  ('c0ffee03-0000-4000-a000-000000000002'::uuid, 'Comment Agency D', 'rls-comment-agency-d');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'charlie@comments.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'clara@comments.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000003'::uuid, 'dave@comments.rls',    'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000004'::uuid, 'diana@comments.rls',   'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef003-0003-4000-a000-000000000005'::uuid, 'cora@comments.rls',    'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef003-0003-4000-a000-000000000001'::uuid, 'charlie@comments.rls', 'Agent Charlie'),
  ('dbeef003-0003-4000-a000-000000000002'::uuid, 'clara@comments.rls',   'Talent Clara'),
  ('dbeef003-0003-4000-a000-000000000003'::uuid, 'dave@comments.rls',    'Agent Dave'),
  ('dbeef003-0003-4000-a000-000000000004'::uuid, 'diana@comments.rls',   'Talent Diana'),
  ('dbeef003-0003-4000-a000-000000000005'::uuid, 'cora@comments.rls',    'Talent Cora');

-- Agency C: agent Charlie + two talent (Clara, Cora). Agency D: agent Dave + talent Diana.
INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'agent'),
  ('dbeef003-0003-4000-a000-000000000004'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'talent'),
  ('dbeef003-0003-4000-a000-000000000005'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'talent');

-- Videos (needed for FK chain: comments -> video_versions -> videos)
INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'Clara Showreel'),
  ('b1de0003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'dbeef003-0003-4000-a000-000000000004'::uuid, 'Diana Showreel'),
  ('b1de0003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000005'::uuid, 'Cora Showreel');

-- Video versions
INSERT INTO video_versions (id, video_id, agency_id, version_number, r2_key, file_size_bytes, uploaded_by) VALUES
  ('bee00003-0003-4000-a000-000000000001'::uuid, 'b1de0003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 1, 'agency-c/clara-v1.mp4', 100000000, 'dbeef003-0003-4000-a000-000000000001'::uuid),
  ('bee00003-0003-4000-a000-000000000002'::uuid, 'b1de0003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 1, 'agency-d/diana-v1.mp4', 100000000, 'dbeef003-0003-4000-a000-000000000003'::uuid),
  ('bee00003-0003-4000-a000-000000000003'::uuid, 'b1de0003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 1, 'agency-c/cora-v1.mp4',  100000000, 'dbeef003-0003-4000-a000-000000000001'::uuid);

-- Agency C: two comments on Clara's video (by Charlie and Clara) and, on
-- Cora's video, one live and one already soft-deleted comment (both by
-- Charlie). Agency D: one comment on Diana's video (by Dave).
INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds) VALUES
  ('c0de0003-0003-4000-a000-000000000001'::uuid, 'bee00003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'Great intro!', 'point', 5.0),
  ('c0de0003-0003-4000-a000-000000000002'::uuid, 'bee00003-0003-4000-a000-000000000001'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000002'::uuid, 'Check the lighting here.', 'point', 12.5),
  ('c0de0003-0003-4000-a000-000000000003'::uuid, 'bee00003-0003-4000-a000-000000000002'::uuid, 'c0ffee03-0000-4000-a000-000000000002'::uuid, 'dbeef003-0003-4000-a000-000000000003'::uuid, 'Agency D comment.', 'point', 3.0),
  ('c0de0003-0003-4000-a000-000000000004'::uuid, 'bee00003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'Cora live comment.', 'point', 7.0);

INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, deleted_at) VALUES
  ('c0de0003-0003-4000-a000-000000000005'::uuid, 'bee00003-0003-4000-a000-000000000003'::uuid, 'c0ffee03-0000-4000-a000-000000000001'::uuid, 'dbeef003-0003-4000-a000-000000000001'::uuid, 'Cora deleted comment.', 'point', 9.0, now());


-- ── Test 1: comments_select — agent sees all agency comments ──────────
-- Agents and above read every comment in their agency, including the
-- soft-deleted one: 2 on Clara's video + 2 on Cora's video.

SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments),
  4,
  'comments_select: Agent Charlie sees all 4 comments in Agency C (both talents'' videos, incl. soft-deleted)'
);


-- ── Test 2: comments_select — agent sees soft-deleted comments ────────
-- #187: soft-deleted rows stay visible so Realtime delivers the UPDATE.
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000005'::uuid),
  1,
  'comments_select: Agent Charlie can see Cora''s soft-deleted comment (#187)'
);


-- ── Test 3: comments_select — talent sees only own-video comments ─────
-- Talent read only comments on videos they own (Clara: 2 on her video;
-- Cora's 2 are on someone else's video).
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments),
  2,
  'comments_select: Talent Clara sees exactly the 2 comments on her own video'
);


-- ── Test 4: comments_select — talent cannot read another talent's comment
-- Cora is in the same agency as Clara, but the video is not Clara's.
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000004'::uuid),
  0,
  'comments_select: Clara cannot read a live comment on Cora''s video (same agency, other talent)'
);


-- ── Test 5: comments_select — same, for a soft-deleted comment ────────
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000005'::uuid),
  0,
  'comments_select: Clara cannot read a soft-deleted comment on Cora''s video'
);


-- ── Test 6: comments_select — cross-agency read blocked ───────────────
-- PRD: Cross-agency data access is impossible.
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000003'::uuid),
  0,
  'comments_select: Clara cannot read Agency D comment (cross-agency isolation)'
);


-- ── Test 7: comments_insert — agency member can insert a comment ───────
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


-- ── Test 8: soft_delete_comment — user can soft-delete their own comment
-- PRD: Comments soft-delete only (deleted_at). No hard delete via any API.
-- Uses SECURITY DEFINER function to bypass SELECT ↔ UPDATE policy interaction.
SELECT lives_ok(
  $$SELECT soft_delete_comment('c0de0003-0003-4000-a000-000000000002'::uuid)$$,
  'soft_delete_comment: Clara can soft-delete her own comment via SECURITY DEFINER function'
);


-- ── Test 9: prevent_comment_undelete — talent cannot restore ──────────
-- C2 is now soft-deleted (Test 8). Clara owns it and can see it, so the
-- direct UPDATE reaches the trigger.
SELECT throws_ok(
  $$UPDATE comments SET deleted_at = NULL
     WHERE id = 'c0de0003-0003-4000-a000-000000000002'::uuid$$,
  '23514',
  'Soft-deleted comments cannot be restored',
  'prevent_comment_undelete: Clara cannot un-delete her own soft-deleted comment'
);


-- ── Test 10: prevent_comment_undelete — agent cannot restore either ───
-- Charlie (agent) tries to restore Cora's soft-deleted comment.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$UPDATE comments SET deleted_at = NULL
     WHERE id = 'c0de0003-0003-4000-a000-000000000005'::uuid$$,
  '23514',
  'Soft-deleted comments cannot be restored',
  'prevent_comment_undelete: Agent Charlie cannot un-delete a soft-deleted comment'
);


-- ── Test 11: No DELETE policy — hard delete silently affects 0 rows ────
-- PRD: Comments soft-delete only. No hard delete via any API endpoint.
--      Without a DELETE policy, RLS silently blocks the operation.
DELETE FROM comments WHERE id = 'c0de0003-0003-4000-a000-000000000001'::uuid;

-- Comment C1 must still exist (DELETE was a no-op due to no DELETE policy)
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000001'::uuid),
  1,
  'No DELETE policy: hard delete on comments silently blocked (comment still exists)'
);

-- ── Test 12: Range comment insert (with end_timestamp_seconds) ───────
SELECT lives_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, end_timestamp_seconds)
    VALUES (
      'c0de0003-0003-4000-a000-000000000010'::uuid,
      'bee00003-0003-4000-a000-000000000001'::uuid,
      'c0ffee03-0000-4000-a000-000000000001'::uuid,
      'dbeef003-0003-4000-a000-000000000001'::uuid,
      'Range comment: cut from here to here.',
      'range',
      5.0,
      10.0
    )$$,
  'Range comment insert with end_timestamp_seconds succeeds'
);


-- ── Test 13: forward soft-delete via direct UPDATE still works ───────
-- The trigger only blocks restoring (non-null -> null). Setting
-- deleted_at on a live comment (null -> now()) must go through.
UPDATE comments
   SET deleted_at = now()
 WHERE id = 'c0de0003-0003-4000-a000-000000000010'::uuid;

SELECT is(
  (SELECT deleted_at IS NOT NULL FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000010'::uuid),
  true,
  'prevent_comment_undelete: soft-deleting a live comment (null -> timestamp) still succeeds'
);


-- ── Test 14: Reply insert (parent_id set to top-level comment) ───────
SELECT lives_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, parent_id)
    VALUES (
      'c0de0003-0003-4000-a000-000000000011'::uuid,
      'bee00003-0003-4000-a000-000000000001'::uuid,
      'c0ffee03-0000-4000-a000-000000000001'::uuid,
      'dbeef003-0003-4000-a000-000000000001'::uuid,
      'Reply to top-level comment.',
      'point',
      5.0,
      'c0de0003-0003-4000-a000-000000000001'::uuid
    )$$,
  'Reply insert to top-level comment succeeds (depth 1)'
);


-- ── Test 15: Reply-to-reply blocked (max depth 1) ───────────────────
-- The reply from Test 14 has parent_id set, so replying to it should fail.
SELECT throws_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds, parent_id)
    VALUES (
      'c0de0003-0003-4000-a000-000000000012'::uuid,
      'bee00003-0003-4000-a000-000000000001'::uuid,
      'c0ffee03-0000-4000-a000-000000000001'::uuid,
      'dbeef003-0003-4000-a000-000000000001'::uuid,
      'Nested reply — should be blocked.',
      'point',
      5.0,
      'c0de0003-0003-4000-a000-000000000011'::uuid
    )$$,
  '23514',
  'Replies can only be made to top-level comments (max depth 1)',
  'Reply-to-reply insert blocked by nesting depth trigger'
);


-- ── Test 16: Cross-agency INSERT blocked ─────────────────────────────
-- Charlie (Agency C) tries to insert a comment into Agency D's video version.
SELECT throws_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds)
    VALUES (
      'c0de0003-0003-4000-a000-000000000013'::uuid,
      'bee00003-0003-4000-a000-000000000002'::uuid,
      'c0ffee03-0000-4000-a000-000000000002'::uuid,
      'dbeef003-0003-4000-a000-000000000001'::uuid,
      'Cross-agency insert attempt.',
      'point',
      1.0
    )$$,
  '42501',
  NULL,
  'Cross-agency INSERT blocked by RLS (agent cannot insert into other agency)'
);


-- ── Test 17: Agent can resolve another user's comment ────────────────
-- Charlie (agent, Agency C) resolves Clara's own comment (Test 7) on
-- Clara's video. (A soft-deleted comment can no longer be restored, so
-- this uses a live one.)
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

UPDATE comments
   SET resolved = true,
       resolved_at = now(),
       resolved_by = 'dbeef003-0003-4000-a000-000000000001'::uuid
 WHERE id = 'c0de0003-0003-4000-a000-000000000099'::uuid;

-- Verify the resolve actually took effect (lives_ok only checks no exception)
SELECT is(
  (SELECT resolved FROM comments WHERE id = 'c0de0003-0003-4000-a000-000000000099'::uuid),
  true,
  'Agent Charlie can resolve Clara''s comment (comments_update_agents policy)'
);


-- ── Test 18: Talent cannot update another user's comment ─────────────
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Diana (talent, Agency D) tries to update Dave's comment on her own video
-- in Agency D. This should silently update 0 rows (no error, but no effect)
UPDATE comments
   SET content = 'Hacked!'
 WHERE id = 'c0de0003-0003-4000-a000-000000000003'::uuid;

SELECT is(
  (SELECT content FROM comments WHERE id = 'c0de0003-0003-4000-a000-000000000003'::uuid),
  'Agency D comment.',
  'Talent Diana cannot update Agent Dave''s comment (only own comments)'
);


-- ── Test 19: second talent sees her own video's comments ─────────────
-- Cora sees exactly the live and the soft-deleted comment on her video.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000005","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments),
  2,
  'comments_select: Talent Cora sees exactly the 2 comments (live + soft-deleted) on her own video'
);


-- ── Test 20: ...and none of the comments on Clara's video ────────────
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE video_version_id = 'bee00003-0003-4000-a000-000000000001'::uuid),
  0,
  'comments_select: Talent Cora cannot read any comment on Clara''s video'
);


-- ── Test 21: Soft-deleted comments stay visible to those who can see the video ──
-- Decision #187 (option b): comments_select has NO `deleted_at IS NULL`
-- filter (migration 0029 matches live; the 0004 filter was never applied
-- there; 0030 keeps that). A soft delete is an UPDATE, and Realtime checks
-- each subscriber's SELECT policy against the new row, so the filter would
-- stop other viewers receiving the soft-delete event. The API excludes
-- deleted rows in app code instead.
-- Clara's comment C2 was soft-deleted in Test 8 and stays deleted (the
-- trigger blocks restoring it). Verify that a member of another agency
-- (Diana, Agency D) still cannot see it, and that Clara, who owns the
-- video, still can. Clara goes last so Test 23 runs as Clara, as it did
-- before.
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000004","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

-- Cross-agency isolation is unchanged for soft-deleted rows.
SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000002'::uuid),
  0,
  'Soft-deleted comment not visible to a member of another agency (cross-agency isolation; #187)'
);


-- ── Test 22: ...but visible to the talent who owns the video ─────────
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef003-0003-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM comments
    WHERE id = 'c0de0003-0003-4000-a000-000000000002'::uuid),
  1,
  'Soft-deleted comment still visible to talent on their own video (Realtime delivers soft deletes; #187)'
);


-- ── Test 23: Content exceeding 2000 chars rejected by CHECK constraint ──
SELECT throws_ok(
  $$INSERT INTO comments (id, video_version_id, agency_id, user_id, content, comment_type, timestamp_seconds)
    VALUES (
      'c0de0003-0003-4000-a000-000000000014'::uuid,
      'bee00003-0003-4000-a000-000000000001'::uuid,
      'c0ffee03-0000-4000-a000-000000000001'::uuid,
      'dbeef003-0003-4000-a000-000000000002'::uuid,
      repeat('x', 2001),
      'point',
      1.0
    )$$,
  '23514',
  NULL,
  'Content exceeding 2000 chars rejected by CHECK constraint'
);


RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
