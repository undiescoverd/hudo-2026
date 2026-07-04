-- =============================================================
-- 0022_talent_upload_rls.sql
--
-- S4-UPLOAD-001: talent self-upload.
--
-- The API layer (app/api/videos/upload/{presign,complete,multipart-url}/route.ts,
-- app/api/videos/[videoId]/thumbnail/route.ts) now permits the `talent` role to
-- drive the upload pipeline for their own videos. The happy path always writes
-- through the service-role admin client plus the SECURITY DEFINER
-- create_video_version() RPC (see 0006_rpc_caller_validation.sql), both of
-- which bypass RLS entirely — so this migration is not load-bearing for that
-- path. It exists for defense-in-depth parity: the DB-level policy must not
-- diverge from what the API now allows, so that any future direct-client
-- write (or a regression in the API's own checks) is still constrained by the
-- same ownership rule (talent_id = auth.uid()) rather than silently relying
-- on the API layer alone.
--
-- videos_insert: previously agent+ only. Now also allows a talent member to
-- insert a video row for themselves (talent_id = auth.uid()) within an agency
-- where they hold the 'talent' role.
--
-- video_versions_insert: previously agent+ only (uploaded_by = self). Now also
-- allows any agency member (including talent) to insert a version for a video
-- they own (talent_id = auth.uid()), still requiring uploaded_by = self.
-- Additionally adds a top-level tenant-integrity invariant covering BOTH
-- branches: the inserted row's agency_id must equal the referenced video's
-- real agency_id. Without it, a user with memberships in two agencies could
-- insert a row {video_id: <video in agency A>, agency_id: B} — satisfying
-- either branch via their agency-B membership — creating a tenant-mismatched
-- row readable by agency B's agents through video_versions_select (which
-- authorizes off the row's own agency_id). This also closes the identical
-- pre-existing gap in the agent+ branch. The legitimate flow is unaffected:
-- the create_video_version RPC always sets agency_id from the route's
-- agencyId, which is verified to equal the video's agency.
--
-- videos_update_talent (pre-existing, deliberately untouched) already lets
-- talent update their own video row for other purposes (e.g. status via the
-- PATCH /status route) — out of scope here.
-- =============================================================

DROP POLICY IF EXISTS "videos_insert" ON videos;
CREATE POLICY "videos_insert" ON videos
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
    OR (
      talent_id = auth.uid()
      AND agency_id IN (
        SELECT agency_id FROM memberships
        WHERE user_id = auth.uid()
          AND role = 'talent'
      )
    )
  );

DROP POLICY IF EXISTS "video_versions_insert" ON video_versions;
CREATE POLICY "video_versions_insert" ON video_versions
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    -- Tenant integrity: the row's agency_id must match the referenced video's
    -- real agency_id. Prevents a multi-agency member from tagging a version of
    -- an agency-A video with agency_id = B (which would leak it to agency B's
    -- agents via video_versions_select).
    AND agency_id = (SELECT agency_id FROM videos WHERE id = video_id)
    AND (
      agency_id IN (
        SELECT agency_id FROM memberships
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin_agent', 'agent')
      )
      OR (
        agency_id IN (
          SELECT agency_id FROM memberships WHERE user_id = auth.uid()
        )
        AND video_id IN (
          SELECT id FROM videos WHERE talent_id = auth.uid()
        )
      )
    )
  );
