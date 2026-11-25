-- =============================================================
-- tests/rls/guest_links_label.test.sql  (migration 0032, S5-GUEST-002)
--
-- guest_links.label: nullable, CHECK 1..80 chars, and the existing
-- row-level policies still govern it (agent+ of the agency only).
-- Separate file from guest_links.test.sql so each keeps its own plan().
-- =============================================================

BEGIN;
SELECT plan(8);

INSERT INTO agencies (id, name, slug) VALUES
  ('c0ffee32-0000-4000-a000-000000000001'::uuid, 'Label Agency A', 'rls-label-agency-a'),
  ('c0ffee32-0000-4000-a000-000000000002'::uuid, 'Label Agency B', 'rls-label-agency-b');

INSERT INTO auth.users (instance_id, id, email, role, aud, created_at, updated_at, email_confirmed_at, raw_user_meta_data, raw_app_meta_data) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef032-0032-4000-a000-000000000001'::uuid, 'agent-a@label.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef032-0032-4000-a000-000000000002'::uuid, 'talent-a@label.rls', 'authenticated', 'authenticated', now(), now(), now(), '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000'::uuid, 'dbeef032-0032-4000-a000-000000000003'::uuid, 'agent-b@label.rls',  'authenticated', 'authenticated', now(), now(), now(), '{}', '{}');

INSERT INTO users (id, email, full_name) VALUES
  ('dbeef032-0032-4000-a000-000000000001'::uuid, 'agent-a@label.rls',  'Agent A'),
  ('dbeef032-0032-4000-a000-000000000002'::uuid, 'talent-a@label.rls', 'Talent A'),
  ('dbeef032-0032-4000-a000-000000000003'::uuid, 'agent-b@label.rls',  'Agent B');

INSERT INTO memberships (user_id, agency_id, role) VALUES
  ('dbeef032-0032-4000-a000-000000000001'::uuid, 'c0ffee32-0000-4000-a000-000000000001'::uuid, 'agent'),
  ('dbeef032-0032-4000-a000-000000000002'::uuid, 'c0ffee32-0000-4000-a000-000000000001'::uuid, 'talent'),
  ('dbeef032-0032-4000-a000-000000000003'::uuid, 'c0ffee32-0000-4000-a000-000000000002'::uuid, 'agent');

INSERT INTO videos (id, agency_id, talent_id, title) VALUES
  ('b1de0032-0032-4000-a000-000000000001'::uuid, 'c0ffee32-0000-4000-a000-000000000001'::uuid, 'dbeef032-0032-4000-a000-000000000002'::uuid, 'Label Showreel');

INSERT INTO guest_links (id, video_id, agency_id, token_hash, created_by, label) VALUES
  ('dead0032-0032-4000-a000-000000000001'::uuid,
   'b1de0032-0032-4000-a000-000000000001'::uuid,
   'c0ffee32-0000-4000-a000-000000000001'::uuid,
   '3232323232323232323232323232323232323232323232323232323232323232',
   'dbeef032-0032-4000-a000-000000000001'::uuid,
   'BBC casting, Sam');

-- 1: column exists
SELECT has_column('public', 'guest_links', 'label', 'guest_links.label exists');

-- 2: agent in the agency reads the label
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef032-0032-4000-a000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT label FROM guest_links WHERE id = 'dead0032-0032-4000-a000-000000000001'::uuid),
  'BBC casting, Sam',
  'agent of the agency can read the label'
);

-- 3: insert with an 80-char label by an agent works
SELECT lives_ok(
  $$INSERT INTO guest_links (video_id, agency_id, token_hash, created_by, label)
    VALUES ('b1de0032-0032-4000-a000-000000000001'::uuid,
            'c0ffee32-0000-4000-a000-000000000001'::uuid,
            '3333333333333333333333333333333333333333333333333333333333333333',
            'dbeef032-0032-4000-a000-000000000001'::uuid,
            repeat('a', 80))$$,
  'an 80 character label is accepted'
);

-- 4: 81 chars rejected by the CHECK
SELECT throws_ok(
  $$INSERT INTO guest_links (video_id, agency_id, token_hash, created_by, label)
    VALUES ('b1de0032-0032-4000-a000-000000000001'::uuid,
            'c0ffee32-0000-4000-a000-000000000001'::uuid,
            '3434343434343434343434343434343434343434343434343434343434343434',
            'dbeef032-0032-4000-a000-000000000001'::uuid,
            repeat('a', 81))$$,
  '23514',
  NULL,
  'an 81 character label violates guest_links_label_length'
);

-- 5: empty string rejected (blank must be stored as NULL)
SELECT throws_ok(
  $$INSERT INTO guest_links (video_id, agency_id, token_hash, created_by, label)
    VALUES ('b1de0032-0032-4000-a000-000000000001'::uuid,
            'c0ffee32-0000-4000-a000-000000000001'::uuid,
            '3535353535353535353535353535353535353535353535353535353535353535',
            'dbeef032-0032-4000-a000-000000000001'::uuid,
            '')$$,
  '23514',
  NULL,
  'an empty label violates guest_links_label_length'
);

-- 5b: whitespace-only label rejected
SELECT throws_ok(
  $$INSERT INTO guest_links (video_id, agency_id, token_hash, created_by, label)
    VALUES ('b1de0032-0032-4000-a000-000000000001'::uuid,
            'c0ffee32-0000-4000-a000-000000000001'::uuid,
            '3636363636363636363636363636363636363636363636363636363636363636',
            'dbeef032-0032-4000-a000-000000000001'::uuid,
            '   ')$$,
  '23514',
  NULL,
  'a whitespace-only label violates guest_links_label_length'
);

-- 6: talent in the same agency sees no links, so no labels
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef032-0032-4000-a000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM guest_links WHERE label IS NOT NULL),
  0,
  'talent cannot read labels'
);

-- 7: agent of another agency cannot read the label
RESET ROLE;
SELECT set_config('request.jwt.claims',
  '{"sub":"dbeef032-0032-4000-a000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM guest_links WHERE label IS NOT NULL),
  0,
  'agent of another agency cannot read labels (cross-agency isolation)'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
