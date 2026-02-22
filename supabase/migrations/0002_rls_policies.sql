-- ============================================================
-- HUDO — RLS POLICIES MIGRATION
-- 0002_rls_policies.sql
-- Run against: Supabase dev, staging, and production
-- ============================================================
-- Tables covered (11): agencies, users, memberships, invitations,
--   videos, video_versions, comments, notifications,
--   notification_preferences, guest_links, audit_log
--
-- Multi-tenancy pattern: agency context is ALWAYS derived from
--   the `memberships` table — never assumed from a column on `users`.
--   A user can belong to multiple agencies.
--
-- Guest access: Guests have ZERO Supabase access. All guest data
--   is served through API routes. No guest RLS policies needed.
--
-- audit_log: No client INSERT/UPDATE/DELETE policies. Inserts happen
--   via service role in API routes only. SELECT for owners/admin_agents.
--
-- Idempotent: DROP POLICY IF EXISTS before every CREATE POLICY.
-- ============================================================

-- ============================================================
-- AGENCIES
-- ============================================================
-- Policy: members can read agencies they belong to
-- Policy: only owners can update their agency
-- No client insert/delete (agencies created via service role in registration API)

DROP POLICY IF EXISTS "agency_select" ON agencies;
CREATE POLICY "agency_select" ON agencies
  FOR SELECT USING (
    id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "agency_update_owner" ON agencies;
CREATE POLICY "agency_update_owner" ON agencies
  FOR UPDATE USING (
    id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role = 'owner'
    )
  );

-- ============================================================
-- USERS
-- ============================================================
-- Policy: users can read their own record
-- Policy: agents/owners can read users in their agency
-- Policy: users can update their own record

DROP POLICY IF EXISTS "users_select_self" ON users;
CREATE POLICY "users_select_self" ON users
  FOR SELECT USING (id = auth.uid());

DROP POLICY IF EXISTS "users_select_agency" ON users;
CREATE POLICY "users_select_agency" ON users
  FOR SELECT USING (
    id IN (
      SELECT m2.user_id FROM memberships m2
      WHERE m2.agency_id IN (
        SELECT agency_id FROM memberships WHERE user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "users_update_self" ON users;
CREATE POLICY "users_update_self" ON users
  FOR UPDATE USING (id = auth.uid());

-- ============================================================
-- MEMBERSHIPS
-- ============================================================
-- Policy: users can see all memberships within agencies they belong to
-- (allows agents/owners to see who else is in their agency)

DROP POLICY IF EXISTS "memberships_select" ON memberships;
CREATE POLICY "memberships_select" ON memberships
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- INVITATIONS
-- ============================================================
-- Policy: agents, admin_agents, and owners can read invitations for their agency
-- Policy: agents+ can insert invitations for their agency

DROP POLICY IF EXISTS "invitations_select" ON invitations;
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

DROP POLICY IF EXISTS "invitations_insert" ON invitations;
CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
    AND invited_by = auth.uid()
  );

-- ============================================================
-- VIDEOS
-- ============================================================
-- Policy: agents/owners/admin_agents can read all videos in their agency
-- Policy: talent can only read their own videos (within their agency)
-- Policy: agents+ can insert videos for their agency
-- Policy: agents+ can update videos in their agency;
--         talent can update only their own videos (status to pending_review only
--         — enforced at the API layer, not here)

DROP POLICY IF EXISTS "videos_select_agents" ON videos;
CREATE POLICY "videos_select_agents" ON videos
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

DROP POLICY IF EXISTS "videos_select_talent" ON videos;
CREATE POLICY "videos_select_talent" ON videos
  FOR SELECT USING (
    talent_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "videos_insert" ON videos;
CREATE POLICY "videos_insert" ON videos
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

DROP POLICY IF EXISTS "videos_update_agents" ON videos;
CREATE POLICY "videos_update_agents" ON videos
  FOR UPDATE USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

DROP POLICY IF EXISTS "videos_update_talent" ON videos;
CREATE POLICY "videos_update_talent" ON videos
  FOR UPDATE USING (
    talent_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- VIDEO VERSIONS
-- ============================================================
-- Policy: users who can see the parent video can see its versions
--   (agency membership check redundant but explicit for clarity)
-- Policy: agents+ can insert video versions for their agency

DROP POLICY IF EXISTS "video_versions_select" ON video_versions;
CREATE POLICY "video_versions_select" ON video_versions
  FOR SELECT USING (
    -- Must be a member of the agency that owns this version
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
    AND (
      -- Agents/owners/admin_agents can see all versions in their agency
      agency_id IN (
        SELECT agency_id FROM memberships
        WHERE user_id = auth.uid()
          AND role IN ('owner', 'admin_agent', 'agent')
      )
      OR
      -- Talent can see versions of their own videos
      video_id IN (
        SELECT id FROM videos
        WHERE talent_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "video_versions_insert" ON video_versions;
CREATE POLICY "video_versions_insert" ON video_versions
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
    AND uploaded_by = auth.uid()
  );

-- ============================================================
-- COMMENTS
-- ============================================================
-- Policy: all agency members can read non-deleted comments
-- Policy: any authenticated agency member can insert a comment
-- Policy: users can update their own comments (e.g., resolve, edit content)
-- Policy: agents+ can update any comment in their agency (e.g., resolve on behalf)
-- Note: hard delete is forbidden; soft delete via deleted_at only

DROP POLICY IF EXISTS "comments_select" ON comments;
CREATE POLICY "comments_select" ON comments
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "comments_insert" ON comments;
CREATE POLICY "comments_insert" ON comments
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS "comments_update_own" ON comments;
CREATE POLICY "comments_update_own" ON comments
  FOR UPDATE USING (
    user_id = auth.uid()
    AND agency_id IN (
      SELECT agency_id FROM memberships WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "comments_update_agents" ON comments;
CREATE POLICY "comments_update_agents" ON comments
  FOR UPDATE USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

-- No hard DELETE policy. Deletion is done via soft delete (deleted_at) through UPDATE.

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
-- Policy: users can only read their own notifications
-- Policy: users can update their own notifications (e.g., mark as read)

DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications
  FOR SELECT USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON notifications;
CREATE POLICY "notifications_update_own" ON notifications
  FOR UPDATE USING (recipient_id = auth.uid());

-- ============================================================
-- NOTIFICATION PREFERENCES
-- ============================================================
-- Policy: users can only read their own preferences
-- Policy: users can update their own preferences
-- Policy: users can insert their own preferences row

DROP POLICY IF EXISTS "notification_prefs_select" ON notification_preferences;
CREATE POLICY "notification_prefs_select" ON notification_preferences
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_prefs_update" ON notification_preferences;
CREATE POLICY "notification_prefs_update" ON notification_preferences
  FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notification_prefs_insert" ON notification_preferences;
CREATE POLICY "notification_prefs_insert" ON notification_preferences
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ============================================================
-- GUEST LINKS
-- ============================================================
-- Policy: agents/owners/admin_agents can read guest links for their agency
-- Policy: agents+ can insert guest links for their agency
-- Policy: agents+ can update (revoke) guest links for their agency
-- No public select — guests access content exclusively through API routes
--   using server-side token validation; they never query this table directly.

DROP POLICY IF EXISTS "guest_links_select" ON guest_links;
CREATE POLICY "guest_links_select" ON guest_links
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

DROP POLICY IF EXISTS "guest_links_insert" ON guest_links;
CREATE POLICY "guest_links_insert" ON guest_links
  FOR INSERT WITH CHECK (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "guest_links_update" ON guest_links;
CREATE POLICY "guest_links_update" ON guest_links
  FOR UPDATE USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent', 'agent')
    )
  );

-- ============================================================
-- AUDIT LOG
-- ============================================================
-- Policy: owners and admin_agents can read audit log for their agency
-- NO client INSERT policy — inserts are performed exclusively via
--   service role in API routes to preserve immutability.
-- NO UPDATE policy — audit log records are immutable.
-- NO DELETE policy — audit log records are immutable.
-- This is enforced at the RLS layer: without an INSERT/UPDATE/DELETE
--   policy, authenticated clients cannot modify audit_log regardless
--   of their role.

DROP POLICY IF EXISTS "audit_log_select" ON audit_log;
CREATE POLICY "audit_log_select" ON audit_log
  FOR SELECT USING (
    agency_id IN (
      SELECT agency_id FROM memberships
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'admin_agent')
    )
  );

-- ============================================================
-- END OF RLS POLICIES
-- ============================================================
-- Summary of policies per table:
--   agencies             : SELECT (members), UPDATE (owners only)
--   users                : SELECT (self + agency members), UPDATE (self)
--   memberships          : SELECT (same-agency members)
--   invitations          : SELECT (agents+), INSERT (agents+)
--   videos               : SELECT (agents: all; talent: own only),
--                          INSERT (agents+), UPDATE (agents+; talent: own only)
--   video_versions       : SELECT (agents: all; talent: own video's),
--                          INSERT (agents+)
--   comments             : SELECT (all agency members), INSERT (all agency members),
--                          UPDATE (own comments; agents+ any comment in agency)
--                          [no DELETE — soft delete via deleted_at only]
--   notifications        : SELECT (own), UPDATE (own)
--   notification_prefs   : SELECT (own), UPDATE (own), INSERT (own)
--   guest_links          : SELECT (agents+), INSERT (agents+), UPDATE (agents+)
--                          [no public access — guests use API routes]
--   audit_log            : SELECT (owners + admin_agents only)
--                          [no client INSERT/UPDATE/DELETE — service role only]
-- ============================================================
