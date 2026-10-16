# Archive, Deletion & GDPR Erasure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This is the living tracker.** Tick boxes as you finish them, update the Status board, and append to the Session log (newest last) before you stop. The next agent starts from the first unticked box in the first phase that isn't ✅.

**Goal:** Let users archive and permanently delete videos and versions, erase a person's or an agency's data (GDPR), and keep R2 storage from leaking. Every level deletes through one path.

**Architecture:** Postgres `SECURITY DEFINER` purge functions (service-role only) do all the row work in one transaction. Each one queues R2 keys/prefixes into `storage_deletions`, decrements `agencies.storage_usage_bytes`, writes `audit_log`, then deletes rows and lets FK cascades remove the children. A daily Vercel cron (`/api/cron/storage-purge`) drains the queue against R2, and later also applies retention and removes empty drafts. Every file of a video lives under `{agencyId}/{videoId}/` (versions: `generateR2Key` in `lib/upload-validation.ts`; thumbnail: `app/api/videos/[videoId]/thumbnail/route.ts:118`), so video and agency purges delete by **prefix**. That also catches thumbnails and failed-upload leftovers.

**Tech Stack:**
- Next.js 14 App Router route handlers
- Supabase Postgres (migrations applied via the `/apply-migration` skill to hudo-dev **and** hudo-staging)
- pgTAP (`supabase test db tests/rls`)
- `node:test` via `tsx` (`pnpm test`)
- Cloudflare R2 through `lib/storage.ts`
- Vercel cron (Hobby: once a day max)
- Resend (`lib/email.ts`)

**Spec:** [`docs/superpowers/specs/2026-10-14-archive-deletion-gdpr-design.md`](../specs/2026-10-14-archive-deletion-gdpr-design.md). Read it first; decision IDs D1–D17 are cited below.

## Status board
| Phase | Sprint | Status | Branch / PR | Tracker |
|---|---|---|---|---|
| 0 · Tracking (issues + sprint rows) | S4 | 🔵 PR #153 open | `chore/archive-deletion-plan-v2` | umbrella #143; sub-issues #144–#148; bugs #149–#151 |
| 1 · Upload bugs B1–B3 | S4 | ⬜ | — | S4-UPLOADFIX-001 · RES-200 · #149 #150 #151 |
| 2 · Delete path foundation | S4 | ⬜ | — | S4-DELETE-001 · RES-201 · #144 |
| 3 · GDPR erasure | S4 | ⬜ | — | S4-ERASE-001 · RES-202 · #145 |
| 4 · Space savers | S4 | ⬜ | — | S4-SAVER-001 · RES-203 · #146 |
| 5 · Archive & restore | post-launch | ⬜ | — | #147 (no sprint row yet) |
| 6 · Agency closure | post-launch | ⬜ | — | #148 (no sprint row yet) |
| 7 · Later (plan names, agency selector) | backlog | ⬜ | — | — |

Legend: ⬜ not started · 🟡 in progress · 🔵 PR open · ✅ merged to `main` (verified with `git log main`, not just "done" in Linear)

## Session log
<!-- Append: `- YYYY-MM-DD · agent/model · phase.task · what happened · next step` -->
- 2026-10-14 · opus · planning · Spec + plan written from the grilling session (Q1–Q20). Waiting on the user to review the plan before Phase 0. Plan display names (Phase 7) still open.
- 2026-10-15 · sonnet · 0.1 · User approved the spec + plan. Filed umbrella #143, sub-issues #144–#148, bugs #149–#151; added S4-UPLOADFIX-001, S4-DELETE-001, S4-ERASE-001, S4-SAVER-001 to tasks/sprint-4.md with Linear RES-200..203. Next: merge this branch, then start Phase 1 (S4-UPLOADFIX-001).
- 2026-10-16 · opus · 0.1 · First PR #152 was closed: its branch had been cut from `chore/unify-dashboard-routes` and carried two unrelated commits, one with a hardcoded dev password (since rotated; see CLAUDE.md Failure Log). Re-opened as PR #153 from `chore/archive-deletion-plan-v2`, which has only the plan commits. Next: merge #153, then Phase 1.

## Global Constraints
- **Every agent rule in CLAUDE.md applies:**
  - Branches are `feat/s4-<TASK_ID>-<slug>` or `chore/<slug>`; never commit to `main`.
  - Run `pnpm format:check && pnpm type-check && pnpm lint && pnpm build` before every push.
  - Worktree agents symlink `node_modules` and `git add` specific paths only.
- **Migrations:**
  - Next free number is **0024**.
  - Apply with the `/apply-migration` skill (MCP `apply_migration`) to **both** hudo-dev (`xyeqnjboqimvhdwnyqbt`) and hudo-staging (`egabjtxrrcuzooyclwgw`). Never use the SQL editor.
  - Every new table gets RLS enabled.
- **Purge functions:**
  - `SECURITY DEFINER`, `SET search_path = public, pg_temp`.
  - `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role`.
  - Call them only from server code through `createAdminClient()`.
- **Comments:** a single comment is soft-delete only; no API hard-deletes one. They're hard-deleted only by a video/version purge (D6).
- **`audit_log`** stays insert-only. The only exception: rows cascade away when their agency is purged (D14).
- **Route files** (`route.ts`) export only reserved fields (GET/POST/DELETE/PATCH/maxDuration). Put helpers in `lib/*.ts`.
- **Cron routes** check `Authorization: Bearer ${CRON_SECRET}` with `timingSafeEqual` (copy `app/api/cron/storage-reconcile/route.ts`), use the schedule `0 3 * * *`, and add `maxDuration = 60`.
- **Copy:** the words are "Archive" / "Archived" (D1) and "comments", never "notes".
- **Retention:** 30 days (D4). Only `agency_pro` can opt out (`agencies.keep_archived`).
- **Permanent delete before expiry:** owner and admin_agent only (D5).
- **Mandatory gates:** `pr-review-toolkit:code-reviewer` on every phase; the `hudo-security-reviewer` and `rls-tenancy-auditor` agents on Phases 2, 3, 5 and 6. Log each run in `SESSIONNOTES.md`.

## Review Focus
Edge cases the spec implies that are most likely to bite. Each line has a test in the named task.
1. **Purging twice**, e.g. the cron retries after a timeout, or two admins click delete together. The second call is a no-op returning 0; the storage counter never goes negative. *(Task 2.2: `purge_video idempotent` + `counter floors at 0`)*
2. **A prefix that could match another tenant**, e.g. `agencyA/vid1` is a string prefix of `agencyA/vid10…`. Prefixes always end in `/` and must match the uuid shape, or the insert fails. *(Task 2.1: `rejects malformed prefix`)*
3. **R2 says the key is already gone.** That counts as success, not a retry, so the queue doesn't spin forever. *(Task 2.3: `already-deleted counts as done`)*
4. **A talent in two agencies, removed by one.** Their videos in the other agency survive, and so does their account. *(Task 3.2: `scoped removal leaves other agency intact`)*
5. **Deleting the current version.** Refused with a clear error, nothing queued, nothing decremented. *(Task 2.2: `refuses active version`)*

---

## Phase 0 — Tracking (do first, needs the user's go-ahead)

### Task 0.1: File the issues and sprint rows (D16)
**Files:** Modify `tasks/sprint-4.md`, `docs/superpowers/plans/2026-10-14-archive-deletion-gdpr.md` (this file: fill the Tracker column).

- [x] **Step 1:** Confirm with the user that the spec + plan are approved. Don't file anything before that.
- [x] **Step 2:** Create the umbrella issue. Paste the spec's "Why", "Decisions" and "The delete path" sections into the body, and link to this plan file.
  ```bash
  gh issue create --title "Archive, deletion & GDPR erasure (umbrella)" --label enhancement --body-file <(sed -n '/## Why/,/## Bugs found/p' docs/superpowers/specs/2026-10-14-archive-deletion-gdpr-design.md)
  ```
- [x] **Step 3:** Create the 5 sub-issues: "Delete path foundation", "GDPR erasure: talent videos + agency-scoped removal", "Space savers: R2 lifecycle + empty drafts", "Archive & restore UI/API", "Agency closure". Each body is "Part of #<umbrella>" plus the phase's task list from this file. Create the 3 bug issues with `--label bug`, bodies from the spec's "Bugs found" section.
- [x] **Step 4:** Add S4 task rows to `tasks/sprint-4.md` for Phases 1–4, in that file's existing format. For each row, create its Linear issue in the same step; the title must start with the exact TASK_ID (Failure Log: "a markdown task with no Linear issue"). Then run `node orchestrate.js sync-check`.
- [x] **Step 5:** Fill in the Tracker column of the Status board with the issue numbers and task IDs. Commit on a `chore/archive-deletion-plan` branch together with the spec and plan files.

---

## Phase 1 — Upload bugs (S4, small, independent of the rest)

### Task 1.1: B2 — Retry reuses the same video
**Files:**
- Modify `app/(dashboard)/upload/page.tsx` (`performUpload`, `runUpload`, `handleRetry`)
- Create `lib/upload-client.ts` (move `performUpload` here so it can be tested; the page imports it)
- Test `lib/upload-client.test.ts`

**Interfaces:**
- Produces `performUpload(f: File, agencyId: string, onProgress: (p: number) => void, opts?: { videoId?: string; talentId?: string; title?: string; onVideoId?: (id: string) => void; fetchImpl?: typeof fetch }): Promise<string>`.
- `onVideoId` fires as soon as presign returns, so the caller can keep the id for retries.

- [ ] **Step 1: Write the failing test.** Stub `fetchImpl`. The presign response is `{ videoId: 'v1', multipart: false, uploadUrl: 'u', r2Key: 'a/v1/x.mp4' }`. Assert:
  - the presign request body includes `videoId: 'v1'` when `opts.videoId = 'v1'` is passed;
  - `onVideoId` is called with `'v1'`.
  
  Stub `XMLHttpRequest` on `globalThis` with a class whose `send()` calls `onload` with `status = 200`.
- [ ] **Step 2:** Run `pnpm exec tsx --test lib/upload-client.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3:** Move `performUpload` into `lib/upload-client.ts`. Add `videoId`/`talentId`/`title` to the presign body when set, and call `opts.onVideoId?.(presign.videoId)`. In the page, keep `const [videoId, setVideoId] = useState<string | null>(null)`. Pass `onVideoId: setVideoId` on the first run and `videoId` on retry.
- [ ] **Step 4:** Run the test. Expect PASS. Run `pnpm type-check`.
- [ ] **Step 5:** Commit: `fix(upload): retry reuses the presigned video instead of creating a new draft`.

### Task 1.2: B3 — Pass through the real error; quota panel only for real quota errors
**Files:**
- Modify `lib/upload-client.ts`, `components/upload/UploadProgress.tsx`
- Test `lib/upload-client.test.ts`, `components/upload/UploadProgress.test.tsx` (create it if missing; follow an existing `components/**/*.test.tsx` pattern)

- [ ] **Step 1:** Failing tests:
  - Presign 402 with body `{ error: 'Your plan is past due — please update payment to continue uploading.' }` → `performUpload` rejects with that exact message.
  - `UploadProgress` with `error="Your plan is past due…"` renders no "Storage quota exceeded" heading. With `error="Storage quota exceeded. Please upgrade…"` it does.
  - A 429 rejects with the server message plus `Retry-After` (read from the header) in the form `"… (try again in N min)"`.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:**
  - Delete the `if (presignRes.status === 402) throw new Error('Storage quota exceeded')` line; the generic branch already passes `body.error` through.
  - In `UploadProgress`, change `isQuotaError` to `error?.startsWith('Storage quota exceeded')`.
  - For 429, append ` (try again in ${Math.ceil(Number(res.headers.get('Retry-After') ?? 60) / 60)} min)`.
- [ ] **Step 4:** Run. Expect PASS.
- [ ] **Step 5:** Commit: `fix(upload): show past-due and rate-limit errors instead of masking them as quota`.

### Task 1.3: B1 — Agents pick the talent
**Files:**
- Create `lib/talent-roster.ts`, test `lib/talent-roster.test.ts`
- Modify `app/(dashboard)/upload/page.tsx`

**Interfaces:**
- Produces `fetchTalentRoster(supabase: SupabaseClient, agencyId: string): Promise<{ id: string; fullName: string }[]>`.
- Query: `memberships.select('user_id, users!memberships_user_id_fkey(full_name)').eq('agency_id', agencyId).eq('role','talent')`. Before relying on that FK name, check it in `0001_initial_schema.sql` / the PostgREST error (Failure Log: name the FK on embeds).

- [ ] **Step 1:** Failing test with a stubbed supabase chain: it returns 2 rows, and the function maps them to `{ id, fullName }`, sorted by name. A PostgREST `error` throws; it is not swallowed into `[]` (Failure Log: "don't swallow the PostgREST error").
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:** Implement. In the page:
  - When `role !== 'talent'`, render a plain `<select required>` of roster names before the drop zone (function-first; the design comes later).
  - Disable the drop zone until a talent is chosen.
  - Pass `talentId` through `performUpload`.
  - Talent never send `talentId`; the server already forces it.
- [ ] **Step 4:** Run tests and `pnpm build`.
- [ ] **Step 5:** Commit: `fix(upload): agents choose the talent so agent uploads reach the talent dashboard`.
- [ ] **Step 6:** Run the `/live-smoke-test` skill on the Preview URL: an agent uploads for Anna, Anna sees it on `/dashboard`. Open the PR, then follow `.claude/skills/pr-fix/SKILL.md`.

---

## Phase 2 — Delete path foundation (S4)

### Task 2.1: Migration 0024 — unblock cascades + `storage_deletions` queue
**Files:**
- Create `supabase/migrations/0024_storage_deletions_and_cascades.sql`
- Test `tests/rls/storage_deletions.test.sql`

**Interfaces:**
- Produces table `storage_deletions(id bigint, agency_id uuid null, target text, is_prefix boolean, bytes bigint, reason text, enqueued_at, attempts int, last_error text, completed_at)`.
- `reason ∈ {'version_purged','video_purged','talent_erased','agency_closed','empty_draft','retention_expired'}`.

- [ ] **Step 1: Check the real constraint names** on dev with `execute_sql`:
  ```sql
  SELECT conname, conrelid::regclass, confdeltype FROM pg_constraint
  WHERE contype='f' AND conrelid::regclass::text IN ('notifications','guest_links','videos')
  ORDER BY 2,1;
  ```
  Expected: `notifications_video_id_fkey`, `notifications_comment_id_fkey`, `guest_links_video_version_id_fkey`, `videos_active_version_id_fkey`, all with `confdeltype = 'a'` (no action). If the names differ, use the real ones below.
- [ ] **Step 2: Write the failing pgTAP test** `tests/rls/storage_deletions.test.sql`. Use the setup style of `tests/rls/storage_quota_rpc.test.sql`: agency, users, video, version, a notification on the video, and a guest link pinned to the version. Tests:
  ```sql
  SELECT plan(7);
  SELECT has_table('public','storage_deletions','queue table exists');
  SELECT ok((SELECT relrowsecurity FROM pg_class WHERE relname='storage_deletions'),'RLS enabled');
  -- as authenticated: no rows visible, insert denied
  SELECT set_config('request.jwt.claims','{"sub":"<agent uuid>","role":"authenticated"}',true); SET LOCAL ROLE authenticated;
  SELECT is((SELECT count(*) FROM storage_deletions),0::bigint,'authenticated sees nothing');
  SELECT throws_ok($$INSERT INTO storage_deletions(target,is_prefix,reason) VALUES ('x/',true,'video_purged')$$,'42501',NULL,'authenticated cannot insert');
  RESET ROLE;
  SELECT throws_ok($$INSERT INTO storage_deletions(target,is_prefix,reason) VALUES ('c0ffee24-0000-4000-a000-000000000001/vid',true,'video_purged')$$,'23514',NULL,'rejects malformed prefix');
  -- cascades now succeed
  UPDATE videos SET active_version_id = NULL WHERE id='<video uuid>';  -- purges always break the cycle first
  DELETE FROM videos WHERE id='<video uuid>';
  SELECT is((SELECT count(*) FROM notifications WHERE video_id='<video uuid>'),0::bigint,'notifications cascade with video');
  SELECT is((SELECT count(*) FROM guest_links WHERE video_id='<video uuid>'),0::bigint,'guest links cascade');
  SELECT * FROM finish(); ROLLBACK;
  ```
  Use fixed uuids in the `c0ffee24-…` / `dbeef024-…` style.
- [ ] **Step 3:** Run `supabase test db tests/rls`. Expect FAIL (no table; delete raises FK violation).
- [ ] **Step 4: Write the migration:**
  ```sql
  -- 0024_storage_deletions_and_cascades.sql
  -- Spec: docs/superpowers/specs/2026-10-14-archive-deletion-gdpr-design.md (D7)

  -- 1. Unblock cascades (these FKs had no ON DELETE, so purges failed)
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_video_id_fkey;
  ALTER TABLE notifications ADD CONSTRAINT notifications_video_id_fkey
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE;
  ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_comment_id_fkey;
  ALTER TABLE notifications ADD CONSTRAINT notifications_comment_id_fkey
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
  ALTER TABLE guest_links DROP CONSTRAINT IF EXISTS guest_links_video_version_id_fkey;
  ALTER TABLE guest_links ADD CONSTRAINT guest_links_video_version_id_fkey
    FOREIGN KEY (video_version_id) REFERENCES video_versions(id) ON DELETE CASCADE;
  ALTER TABLE videos DROP CONSTRAINT IF EXISTS videos_active_version_id_fkey;
  ALTER TABLE videos ADD CONSTRAINT videos_active_version_id_fkey
    FOREIGN KEY (active_version_id) REFERENCES video_versions(id) ON DELETE SET NULL;

  -- 2. R2 deletion queue. agency_id deliberately has NO FK: rows must outlive a purged agency.
  CREATE TABLE IF NOT EXISTS storage_deletions (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agency_id    uuid,
    target       text NOT NULL,
    is_prefix    boolean NOT NULL DEFAULT false,
    bytes        bigint NOT NULL DEFAULT 0,
    reason       text NOT NULL CHECK (reason IN
                   ('version_purged','video_purged','talent_erased','agency_closed','empty_draft','retention_expired')),
    enqueued_at  timestamptz NOT NULL DEFAULT now(),
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    completed_at timestamptz,
    -- A prefix is exactly "{uuid}/" or "{uuid}/{uuid}/": it can never match a sibling tenant/video.
    CONSTRAINT storage_deletions_prefix_shape CHECK (
      NOT is_prefix OR target ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?$'
    )
  );
  CREATE INDEX IF NOT EXISTS storage_deletions_pending_idx
    ON storage_deletions (enqueued_at) WHERE completed_at IS NULL;
  ALTER TABLE storage_deletions ENABLE ROW LEVEL SECURITY;
  -- No policies on purpose: only service_role (which bypasses RLS) touches this table.
  REVOKE ALL ON storage_deletions FROM anon, authenticated;
  ```
- [ ] **Step 5:** Run pgTAP. Expect PASS (7/7), and the existing RLS suite stays green.
- [ ] **Step 6:** Apply to dev + staging with `/apply-migration`. Verify with the Step 1 query (`confdeltype` is `c`/`n`).
- [ ] **Step 7:** Commit: `feat(db): storage_deletions queue + cascade FKs for purges (0024)`.

### Task 2.2: Migration 0025 — purge functions
**Files:**
- Create `supabase/migrations/0025_purge_functions.sql`
- Test `tests/rls/purge_functions.test.sql`

**Interfaces (all `RETURNS bigint` = bytes freed; service_role only):**
- `purge_video(p_video_id uuid, p_reason text, p_actor_id uuid, p_actor_name text)`. Queues the prefix `{agency}/{video}/` and returns 0 if the video is already gone.
- `purge_video_version(p_version_id uuid, p_reason text, p_actor_id uuid, p_actor_name text)`. Queues the exact `r2_key`. Raises `P0409` if it's the video's `active_version_id`.
- `purge_talent_in_agency(p_talent_id uuid, p_agency_id uuid, p_actor_id uuid, p_actor_name text)`. Calls `purge_video(…, 'talent_erased', …)` for each matching video.
- `purge_agency(p_agency_id uuid)`. Queues the prefix `{agency}/`, then `DELETE FROM agencies`. Everything else cascades, including `audit_log` (D14).

- [ ] **Step 1: Failing pgTAP** `tests/rls/purge_functions.test.sql`. Setup: agency (usage 300), video V1 with versions 100 + 200 bytes (active = v2), a comment + reply on v1, and video V2 in a second agency for the same talent. Tests:
  ```sql
  SELECT plan(12);
  -- refuses active version
  SELECT throws_ok($$SELECT purge_video_version('<v2 id>','version_purged',NULL,'System')$$,'P0409',NULL,'refuses active version');
  SELECT is((SELECT count(*) FROM storage_deletions),0::bigint,'nothing queued after refusal');
  -- old version purge
  SELECT is(purge_video_version('<v1 id>','version_purged',NULL,'System'),100::bigint,'returns bytes freed');
  SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id='<agency A>'),200::bigint,'counter decremented');
  SELECT is((SELECT count(*) FROM comments WHERE video_version_id='<v1 id>'),0::bigint,'comments (incl. replies) removed with version');
  SELECT is((SELECT target FROM storage_deletions ORDER BY id DESC LIMIT 1),'<v1 r2_key>','exact key queued');
  -- video purge
  SELECT is(purge_video('<V1>','video_purged',NULL,'System'),200::bigint,'video purge frees remaining bytes');
  SELECT ok(EXISTS(SELECT 1 FROM storage_deletions WHERE target='<agency A>/<V1>/' AND is_prefix),'prefix queued');
  SELECT ok(EXISTS(SELECT 1 FROM audit_log WHERE action='video_purged' AND resource_id='<V1>'),'audit row written');
  SELECT is(purge_video('<V1>','video_purged',NULL,'System'),0::bigint,'purge_video idempotent');
  -- counter floors at 0 (simulate drift)
  UPDATE agencies SET storage_usage_bytes=5 WHERE id='<agency B>';
  SELECT purge_video('<V2>','talent_erased',NULL,'System');
  SELECT is((SELECT storage_usage_bytes FROM agencies WHERE id='<agency B>'),0::bigint,'counter floors at 0');
  -- authenticated cannot call
  SET LOCAL ROLE authenticated;
  SELECT throws_ok($$SELECT purge_agency('<agency A>')$$,'42501',NULL,'authenticated cannot execute');
  RESET ROLE;
  SELECT * FROM finish(); ROLLBACK;
  ```
  Add 3 more tests in the same file (bump `plan`):
  - `purge_talent_in_agency` touches only that agency's videos;
  - `purge_agency` leaves no `videos`/`memberships`/`audit_log` rows for the agency and queues `'<agency>/'`;
  - the agency's `storage_deletions` rows survive the agency delete.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3: Write the migration:**
  ```sql
  -- 0025_purge_functions.sql — the single delete path (spec D7). service_role only.
  CREATE OR REPLACE FUNCTION purge_video(p_video_id uuid, p_reason text, p_actor_id uuid, p_actor_name text)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DECLARE v_agency uuid; v_bytes bigint;
  BEGIN
    SELECT agency_id INTO v_agency FROM videos WHERE id = p_video_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 0; END IF;                       -- idempotent
    SELECT COALESCE(SUM(file_size_bytes), 0) INTO v_bytes FROM video_versions WHERE video_id = p_video_id;
    INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
      VALUES (v_agency, v_agency || '/' || p_video_id || '/', true, v_bytes, p_reason);
    UPDATE agencies SET storage_usage_bytes = GREATEST(storage_usage_bytes - v_bytes, 0) WHERE id = v_agency;
    INSERT INTO audit_log (agency_id, actor_id, actor_name, action, resource_type, resource_id, metadata)
      VALUES (v_agency, p_actor_id, p_actor_name, 'video_purged', 'video', p_video_id,
              jsonb_build_object('reason', p_reason, 'bytes', v_bytes));
    UPDATE videos SET active_version_id = NULL WHERE id = p_video_id;  -- break the videos<->versions cycle first
    DELETE FROM videos WHERE id = p_video_id;                          -- cascades versions, comments, guest_links, comment_reads, notifications
    RETURN v_bytes;
  END $$;

  CREATE OR REPLACE FUNCTION purge_video_version(p_version_id uuid, p_reason text, p_actor_id uuid, p_actor_name text)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DECLARE v_video uuid; v_agency uuid; v_key text; v_bytes bigint;
  BEGIN
    SELECT video_id, agency_id, r2_key, file_size_bytes INTO v_video, v_agency, v_key, v_bytes
      FROM video_versions WHERE id = p_version_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 0; END IF;
    IF EXISTS (SELECT 1 FROM videos WHERE id = v_video AND active_version_id = p_version_id) THEN
      RAISE EXCEPTION 'Cannot delete the current version; delete the video or upload a new version'
        USING ERRCODE = 'P0409';
    END IF;
    INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
      VALUES (v_agency, v_key, false, v_bytes, p_reason);
    UPDATE agencies SET storage_usage_bytes = GREATEST(storage_usage_bytes - v_bytes, 0) WHERE id = v_agency;
    INSERT INTO audit_log (agency_id, actor_id, actor_name, action, resource_type, resource_id, metadata)
      VALUES (v_agency, p_actor_id, p_actor_name, 'version_purged', 'video', v_video,
              jsonb_build_object('reason', p_reason, 'bytes', v_bytes, 'version_id', p_version_id));
    DELETE FROM video_versions WHERE id = p_version_id;
    RETURN v_bytes;
  END $$;

  CREATE OR REPLACE FUNCTION purge_talent_in_agency(p_talent_id uuid, p_agency_id uuid, p_actor_id uuid, p_actor_name text)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DECLARE v_id uuid; v_total bigint := 0;
  BEGIN
    FOR v_id IN SELECT id FROM videos WHERE talent_id = p_talent_id AND agency_id = p_agency_id LOOP
      v_total := v_total + purge_video(v_id, 'talent_erased', p_actor_id, p_actor_name);
    END LOOP;
    RETURN v_total;
  END $$;

  CREATE OR REPLACE FUNCTION purge_agency(p_agency_id uuid)
  RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DECLARE v_bytes bigint;
  BEGIN
    SELECT storage_usage_bytes INTO v_bytes FROM agencies WHERE id = p_agency_id FOR UPDATE;
    IF NOT FOUND THEN RETURN 0; END IF;
    INSERT INTO storage_deletions (agency_id, target, is_prefix, bytes, reason)
      VALUES (p_agency_id, p_agency_id || '/', true, COALESCE(v_bytes, 0), 'agency_closed');
    UPDATE videos SET active_version_id = NULL WHERE agency_id = p_agency_id;
    DELETE FROM agencies WHERE id = p_agency_id;  -- cascades everything incl. audit_log (documented exception, D14)
    RETURN COALESCE(v_bytes, 0);
  END $$;

  DO $$ DECLARE f text; BEGIN
    FOREACH f IN ARRAY ARRAY[
      'purge_video(uuid,text,uuid,text)', 'purge_video_version(uuid,text,uuid,text)',
      'purge_talent_in_agency(uuid,uuid,uuid,text)', 'purge_agency(uuid)'] LOOP
      EXECUTE format('ALTER FUNCTION public.%s OWNER TO postgres', f);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END LOOP;
  END $$;
  ```
- [ ] **Step 4:** Add `'video_purged' | 'version_purged'` to `AuditAction` in `lib/audit.ts`, and to the valid-values comment in a new migration comment (don't edit 0001).
- [ ] **Step 5:** Run pgTAP. Expect PASS. Run the `rls-tenancy-auditor` and `hudo-security-reviewer` agents on the diff.
- [ ] **Step 6:** Apply to dev + staging. Commit: `feat(db): purge functions — one delete path for version/video/talent/agency (0025)`.

### Task 2.3: R2 prefix delete + queue drainer
**Files:**
- Modify `lib/storage.ts` (add to the `StorageClient` interface + implementation)
- Create `lib/storage-purge.ts`, test `lib/storage-purge.test.ts`
- Update every test stub of `StorageClient`: `grep -rln "sumSizesUnderPrefix: async" app lib` and add `deletePrefix: async () => 0`.

**Interfaces:**
- `StorageClient.deletePrefix(prefix: string): Promise<number>`: list with `ListObjectsV2Command` (paginate, like `sumSizesUnderPrefix`), delete in `DeleteObjectsCommand` batches of ≤1000, return the count deleted. It throws if `prefix` doesn't end in `/`.
- `drainStorageDeletions(deps?: { admin?: SupabaseClient; storage?: StorageClient; batchSize?: number; maxAttempts?: number }): Promise<{ processed: number; failed: number; skipped: number }>`:
  - selects `completed_at IS NULL AND attempts < maxAttempts (default 5)` ordered by `enqueued_at`, limit `batchSize` (default 200);
  - for each row: prefix → `deletePrefix`, key → `deleteObject`;
  - success → `completed_at = now()`; failure → `attempts + 1`, `last_error`.

- [ ] **Step 1: Failing tests** in `lib/storage-purge.test.ts`, with a stubbed admin client + storage (follow the `makeStorage` pattern in `app/api/cron/storage-reconcile/route.test.ts`):
  - a prefix row calls `deletePrefix('a/v/')` and is marked complete;
  - a key row calls `deleteObject` and is marked complete;
  - **already-deleted counts as done:** `deleteObject` throwing `{ name: 'NoSuchKey' }` → marked complete, not failed;
  - another error → `attempts` incremented, `last_error` set, `failed: 1`;
  - rows at `maxAttempts` aren't selected, and are reported to Sentry once (`Sentry.captureMessage`, like `lib/storage-reconcile.ts`).
- [ ] **Step 2:** Run `pnpm exec tsx --test lib/storage-purge.test.ts`. Expect FAIL.
- [ ] **Step 3:** Implement `deletePrefix` (S3 SDK `DeleteObjectsCommand` with `Quiet: true`) and `drainStorageDeletions`.
- [ ] **Step 4:** Run. Expect PASS. Run `pnpm test` (the whole suite stays green after the stub updates).
- [ ] **Step 5:** Commit: `feat(storage): deletePrefix + storage_deletions drainer`.

### Task 2.4: Daily cron `/api/cron/storage-purge`
**Files:**
- Create `app/api/cron/storage-purge/route.ts`, test `app/api/cron/storage-purge/route.test.ts`
- Modify `vercel.json`, `docs/ops/cron-schedule.md`

**Interfaces:**
- Consumes `drainStorageDeletions`.
- Later phases add `purgeEmptyDrafts` (Phase 4) and `purgeExpiredArchive` (Phase 5) to `runStoragePurge` in `lib/storage-purge.ts`; the route calls only `runStoragePurge(deps)`.

- [ ] **Step 1: Failing route tests**, copying `storage-reconcile/route.test.ts`:
  - a missing `CRON_SECRET` gives 500;
  - a wrong bearer gives 401;
  - the right bearer gives 200 with the drainer's result JSON.
- [ ] **Step 2:** Run. Expect FAIL.
- [ ] **Step 3:**
  - Implement the route: an auth block copied from storage-reconcile, `maxDuration = 60`, export only `GET` + `maxDuration`.
  - Add `runStoragePurge(deps)` to `lib/storage-purge.ts`. For now it returns `{ drained: await drainStorageDeletions(deps) }`.
  - Add `{ "path": "/api/cron/storage-purge", "schedule": "0 3 * * *" }` to `vercel.json`, and document it in `docs/ops/cron-schedule.md`.
- [ ] **Step 4:** Run tests, then `pnpm build` (catches invalid route exports).
- [ ] **Step 5:** Edit CLAUDE.md → Critical Architecture Rules. Replace the comments bullet with:

  > **Comments soft-delete only** (`deleted_at`). No API endpoint hard-deletes a single comment. Comments are hard-deleted only by the purge functions (0025), together with their version/video.

  Add: **"All deletes go through the purge functions + `storage_deletions` queue. Never call `storage.deleteObject` or `DELETE FROM videos` directly."**
- [ ] **Step 6:** Commit: `feat(cron): daily storage-purge drains the R2 deletion queue`. Open the PR (Phase 2 = one PR), run the reviewers, and follow `pr-fix`.
- [ ] **Step 7: Live check on staging.**
  1. Upload a throwaway video.
  2. Call `purge_video` via MCP `execute_sql` as service role.
  3. Trigger the cron with `curl -H "Authorization: Bearer $CRON_SECRET" <preview>/api/cron/storage-purge`.
  4. Confirm `HeadObject` gives 404 and the agency's usage went down.
  
  Record the result in SESSIONNOTES.

---

## Phase 3 — GDPR erasure (S4; needs Phase 2 merged)

> The tasks below give files, behaviour and test cases.

- [ ] **3.0 Expand this phase into step-level TDD tasks** (failing test → run → implement → pass → commit, like Phase 2). Re-read `lib/erasure.ts`, `app/api/users/[userId]/data/route.ts` and their tests first, and write the expansion into this file.

### Task 3.1: A talent's own erasure deletes their videos everywhere (D12, D13 self)
**Files:** Modify `lib/erasure.ts`, `lib/erasure.test.ts`
- [ ] In `eraseUser`, after `capture_memberships` and **before** `tombstone_user`, add step `purge_talent_videos`. For each `agencyId` the target belongs to, call `admin.rpc('purge_talent_in_agency', { p_talent_id, p_agency_id, p_actor_id: null, p_actor_name: 'GDPR erasure' })`. On error, return `{ ok: false, step: 'purge_talent_videos' }`. The step is idempotent, so re-running works.
- [ ] Tests:
  - the rpc is called once per membership agency, before the tombstone update (record call order in the stub);
  - an rpc error stops erasure at that step;
  - zero memberships means no rpc call.

### Task 3.2: Agency-scoped removal (D13)
**Files:**
- Modify `lib/erasure.ts` (new `removeMemberWithData`), `app/api/users/[userId]/data/route.ts`
- Tests: `lib/erasure.test.ts`, `app/api/users/[userId]/data/route.test.ts`

**Interfaces:** `removeMemberWithData(admin, targetUserId, agencyId, actor: { id: string; name: string }): Promise<ErasureResult & { accountErased?: boolean }>`:
1. Calls `purge_talent_in_agency` for that agency.
2. Deletes that membership.
3. If the target has 0 memberships left, calls `eraseUser`.

- [ ] Route:
  - Caller === target → full `eraseUser` (everything, everywhere).
  - Otherwise require the query `?agencyId=`, check `canEraseUser` against **that agency only** (owner; admin_agent for non-elevated targets), then call `removeMemberWithData`.
  - A missing `agencyId` for a non-self call gives 400.
- [ ] Tests:
  - **scoped removal leaves other agency intact:** a target in A + B, removed by A's owner → rpc only for A, B membership kept, `eraseUser` not called;
  - a target only in A → `accountErased: true`;
  - an admin_agent can't remove an owner (403);
  - an agent (not admin) gets 403.

### Task 3.3: Erasure emails (D15)
**Files:**
- Create `lib/email-templates/erasure-confirmation.ts`, `lib/email-templates/member-removed-receipt.ts`
- Modify `lib/erasure.ts` (or the route) to send via `sendEmail` from `lib/email.ts`
- [ ] Capture the target's email **before** the tombstone.
- [ ] Send the confirmation to the target, and the receipt to the agency owner(s) on scoped removal.
- [ ] Never fail the erasure because an email failed: log + Sentry.
- [ ] Instantiate Resend inside the function (Failure Log: `new Resend('')` at module scope breaks the build).
- [ ] Tests: both emails sent with the right recipients; an email throwing still returns `ok: true`.
- [ ] Run `hudo-security-reviewer`. Open the PR and follow `pr-fix`. Live-verify on hudo-dev with a throwaway talent in two agencies.

---

## Phase 4 — Space savers (S4; needs Phase 2)

### Task 4.1: R2 lifecycle rule for abandoned multipart uploads (D8)
**Files:** Modify `docs/r2-setup.md`
- [ ] Document and apply to hudo-dev and hudo-staging (prod: add to the pre-launch checklist) a rule that aborts incomplete multipart uploads after 1 day:
  ```bash
  aws s3api put-bucket-lifecycle-configuration --endpoint-url "$R2_ENDPOINT" --bucket hudo-staging \
    --lifecycle-configuration '{"Rules":[{"ID":"abort-incomplete-multipart","Status":"Enabled","Filter":{"Prefix":""},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":1}}]}'
  ```
- [ ] Verify with `aws s3api get-bucket-lifecycle-configuration`. Make sure the existing CORS (with `ExposeHeaders: ["ETag"]`) is untouched.

### Task 4.2: Purge empty drafts (D8)
**Files:**
- Create `supabase/migrations/0026_purge_empty_drafts.sql`, test `tests/rls/purge_functions.test.sql` (extend)
- Modify `lib/storage-purge.ts` + test
- [ ] Add a function `purge_empty_drafts(p_older_than interval DEFAULT '24 hours') RETURNS integer`. It loops over `videos WHERE status='draft' AND active_version_id IS NULL AND NOT EXISTS (SELECT 1 FROM video_versions WHERE video_id = videos.id) AND created_at < now() - p_older_than`, and calls `purge_video(id, 'empty_draft', NULL, 'System')`. Service_role only.
- [ ] pgTAP:
  - a 2-day-old empty draft is purged;
  - a 1-hour-old one stays (the upload may be in progress);
  - a draft with a version stays.
- [ ] `runStoragePurge` calls `admin.rpc('purge_empty_drafts')` **before** draining, so the prefixes go out the same night. Unit test the call order.

---

## Phase 5 — Archive & restore (post-launch)

> Expand into step-level TDD tasks (superpowers:writing-plans) when this phase starts. Design the UI first: a prototype in `.figma-prototype/redesign-v3/` (archive action in the player + dashboard row menu, the "Archived · N" chip, the Archived list with "Deleted in N days"), following the design workflow in `HANDOFF.md`.

- [ ] **5.0 Expand this phase into step-level TDD tasks** in this file, after the UI prototype is locked.
- [ ] **5.1 Migration 0027:**
  - columns `archived_at timestamptz`, `archived_by uuid REFERENCES users(id) ON DELETE SET NULL`, `purge_after timestamptz` on `videos` and `video_versions`;
  - `agencies.keep_archived boolean NOT NULL DEFAULT false`;
  - partial indexes `WHERE archived_at IS NOT NULL`.
  
  pgTAP: talent can't set `archived_at` on another talent's video (existing update policies) and can on their own.
- [ ] **5.2 API (Zod-validated, rate-limited, `requireMembership`):**
  - `POST /api/videos/[videoId]/archive` and `/restore`: talent own, agents any (D5); sets `purge_after = now() + 30 days`, or NULL when `keep_archived` and the plan is `agency_pro`.
  - Same for `/api/videos/[videoId]/versions/[versionId]/archive|restore`; archiving the active version gives 409 (D2). Restoring a video restores its versions (D9).
  - `DELETE /api/videos/[videoId]` and `.../versions/[versionId]` (permanent): owner/admin_agent only, the item must already be archived, calls the purge rpc.
  - All of them write audit rows `video_archived` / `video_restored` (add to `AuditAction`).
- [ ] **5.3 Archived items behave as gone (D3):**
  - dashboards (`lib/dashboard.ts`, `lib/talent-dashboard.ts`) filter `archived_at IS NULL`;
  - guest link resolve (`app/api/guest/...`) returns 404 for archived;
  - comments POST and status PATCH return 409 for archived;
  - the version list hides archived versions except in the Archived view.
  
  Unit test each guard.
- [ ] **5.4 Retention in the cron:** `runStoragePurge` calls a new rpc `purge_expired_archive()` (`purge_after < now()` → `purge_video`/`purge_video_version` with `'retention_expired'`).
- [ ] **5.5 Downgrade rule (D4):** in the Stripe webhook plan-change path (`lib/billing.ts` / webhook route), on a move away from `agency_pro`:
  - set `keep_archived = false`;
  - set `purge_after = now() + 30 days` where it's NULL;
  - email the owner.
- [ ] **5.6 UI:**
  - archive/restore actions;
  - the "Archived · N" chip on both dashboards (D11);
  - the Archived list showing "Archived by X · N days ago · deleted in N days" (D10, no notifications);
  - the agency_pro setting in Settings → Billing.
- [ ] **5.7** Run the reviewers (code, security, RLS). Live smoke on Preview. Update the CLAUDE.md "Sprints" line.

## Phase 6 — Agency closure (post-launch; until then, run closures by hand with `SELECT purge_agency('<id>')` as service role, after cancelling Stripe)

> Expand into step-level tasks when this phase starts.

- [ ] **6.0 Expand this phase into step-level TDD tasks** in this file.
- [ ] **6.1 Migration:** `agencies.closing_at timestamptz`, `closure_requested_by uuid`. The layout/middleware blocks every member when `closing_at IS NOT NULL` and shows a "This agency is closing on {date}" screen. The owner sees "Cancel closure".
- [ ] **6.2 Request and cancel:**
  - `POST /api/agencies/[id]/close` (owner only; body `{ confirmName }` must equal `agencies.name`) cancels the Stripe subscription at once (`lib/stripe.ts`), sets `closing_at = now() + 7 days`, and emails the owner + members (D15).
  - `DELETE` on the same route cancels the closure inside the window.
- [ ] **6.3 Cron step:** for agencies past `closing_at`:
  1. Capture the members.
  2. Run `purge_agency`.
  3. Run `eraseUser` for each member with 0 memberships left.
  4. Email the owner that the closure is complete.
- [ ] **6.4** Document the `audit_log` cascade exception in CLAUDE.md → Critical Architecture Rules. Add a DPA/privacy-policy note that backups (Supabase PITR) expire deleted data within the backup window.

## Phase 7 — Later / backlog
- [ ] **Plan display names.**
  - Pick from the options in `.figma-prototype/redesign-v3/claude-design-bundle-upload/` (recommended: Free · Starter · Team · Agency). Then change `displayName` in `lib/plans.ts` and the Stripe product names via `scripts/setup-stripe.ts`.
  - IDs and lookup keys stay the same. Run `scripts/verify-plan-consistency.ts`.
- [ ] **Multi-agency selector on upload** (deferred, see the upload BRIEF decision 3).
- [ ] **Re-submit on new version of in_review/approved** (upload decision 4). It's in the upload-flow work, not here; listed for cross-reference only.

---

## Self-review notes (planner, 2026-10-14)
- **Spec coverage:**

  | Decision | Covered by |
  |---|---|
  | D1–D3, D9–D11 | Phase 5 |
  | D4 | 5.2, 5.4, 5.5 |
  | D5 | 5.2 |
  | D6 | Task 2.4 Step 5 |
  | D7 | Phase 2 |
  | D8 | Phase 4 |
  | D12–D13 | Phase 3 |
  | D14 | 2.2 (`purge_agency`) + Phase 6 |
  | D15 | 3.3 + 6.2/6.3 |
  | D16 | Phase 0 |
  | D17 | Status board sprint column |
  | B1–B3 | Phase 1 |

- **Deliberate deviation from the plan template:** Phases 0–2 and 4 are step-level. Phases 3, 5 and 6 list exact files, behaviour and test cases, but are expanded into step-level TDD tasks when they start. They depend on the earlier phases' real code and (for 5) a UI design that doesn't exist yet. That expansion is the first box of each phase.
