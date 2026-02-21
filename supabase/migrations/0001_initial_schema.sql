-- ============================================================
-- HUDO — INITIAL SCHEMA MIGRATION
-- 0001_initial_schema.sql
-- Run against: Supabase dev, staging, and production
-- ============================================================
-- Tables: agencies, users, memberships, invitations, videos,
--         video_versions, comments, notifications,
--         notification_preferences, guest_links, audit_log (11 total)
-- Indexes: all required indexes from PRD Section 4.3
-- RLS: enabled on all tables (policies applied in 0002)
-- RPC: create_video_version (transactional version numbering)
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- AGENCIES
-- ============================================================

CREATE TABLE IF NOT EXISTS agencies (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   text NOT NULL,
  slug                   text NOT NULL UNIQUE,
  plan                   text NOT NULL DEFAULT 'freemium'
                           CHECK (plan IN ('freemium', 'starter', 'studio', 'agency_pro')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text NOT NULL DEFAULT 'active'
                           CHECK (subscription_status IN ('active', 'trialing', 'past_due', 'canceled')),
  storage_usage_bytes    bigint NOT NULL DEFAULT 0,
  storage_limit_bytes    bigint NOT NULL DEFAULT 5368709120, -- 5GB default (freemium)
  legal_name             text,
  billing_address        jsonb,
  vat_number             text,
  dpa_accepted_at        timestamptz,
  dpa_accepted_ip        text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- USERS
-- (mirrors auth.users — id is the Supabase auth user UUID)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY, -- matches auth.users.id
  email       text NOT NULL UNIQUE,
  full_name   text NOT NULL,
  avatar_url  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- MEMBERSHIPS
-- (multi-tenancy join table — a user can belong to many agencies)
-- ============================================================

CREATE TABLE IF NOT EXISTS memberships (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agency_id  uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  role       text NOT NULL
               CHECK (role IN ('owner', 'admin_agent', 'agent', 'talent')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agency_id)
);

CREATE INDEX IF NOT EXISTS memberships_user_id_idx ON memberships (user_id);
CREATE INDEX IF NOT EXISTS memberships_agency_id_idx ON memberships (agency_id);

-- ============================================================
-- INVITATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS invitations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id    uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  invited_by   uuid NOT NULL REFERENCES users(id),
  email        text NOT NULL,
  role         text NOT NULL
                 CHECK (role IN ('admin_agent', 'agent', 'talent')),
  token_hash   text NOT NULL UNIQUE, -- SHA-256 hash of plaintext token; never store plaintext
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- VIDEOS
-- ============================================================

CREATE TABLE IF NOT EXISTS videos (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id         uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  talent_id         uuid NOT NULL REFERENCES users(id),
  title             text NOT NULL,
  status            text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'pending_review', 'in_review', 'changes_requested', 'approved')),
  active_version_id uuid, -- FK to video_versions added after that table is created
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS videos_agency_id_idx ON videos (agency_id);

-- ============================================================
-- VIDEO VERSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS video_versions (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id         uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  agency_id        uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  version_number   integer NOT NULL,
  r2_key           text NOT NULL,
  file_size_bytes  bigint NOT NULL,
  duration_seconds integer, -- nullable; populated post-upload
  uploaded_by      uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, version_number)
);

CREATE INDEX IF NOT EXISTS video_versions_video_id_idx ON video_versions (video_id);

-- Add FK from videos to video_versions now that the table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'videos_active_version_id_fkey'
      AND table_name = 'videos'
  ) THEN
    ALTER TABLE videos
      ADD CONSTRAINT videos_active_version_id_fkey
      FOREIGN KEY (active_version_id) REFERENCES video_versions(id);
  END IF;
END
$$;

-- ============================================================
-- COMMENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS comments (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_version_id      uuid NOT NULL REFERENCES video_versions(id) ON DELETE CASCADE,
  agency_id             uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(id),
  content               text NOT NULL CHECK (char_length(content) <= 2000),
  comment_type          text NOT NULL CHECK (comment_type IN ('point', 'range')),
  timestamp_seconds     numeric NOT NULL,
  end_timestamp_seconds numeric, -- nullable; only for range comments
  parent_id             uuid REFERENCES comments(id), -- nullable; max depth 1
  resolved              boolean NOT NULL DEFAULT false,
  resolved_at           timestamptz,
  resolved_by           uuid REFERENCES users(id),
  deleted_at            timestamptz, -- soft delete
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comments_video_version_id_idx ON comments (video_version_id);
CREATE INDEX IF NOT EXISTS comments_resolved_idx ON comments (resolved);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id     uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type          text NOT NULL
                  CHECK (type IN ('new_comment', 'comment_resolved', 'status_changed', 'invitation_accepted')),
  video_id      uuid REFERENCES videos(id),
  comment_id    uuid REFERENCES comments(id),
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index on recipient_id (column is recipient_id, not user_id)
CREATE INDEX IF NOT EXISTS notifications_recipient_id_idx ON notifications (recipient_id);

-- ============================================================
-- NOTIFICATION PREFERENCES
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id                uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email_enabled          boolean NOT NULL DEFAULT true,
  batch_window_minutes   integer NOT NULL DEFAULT 15
                           CHECK (batch_window_minutes IN (5, 15, 30, 60))
);

-- ============================================================
-- GUEST LINKS
-- ============================================================

CREATE TABLE IF NOT EXISTS guest_links (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id         uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  agency_id        uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  video_version_id uuid REFERENCES video_versions(id),
  token_hash       text NOT NULL UNIQUE, -- SHA-256 hash of plaintext token; never store plaintext
  created_by       uuid NOT NULL REFERENCES users(id),
  expires_at       timestamptz,
  revoked_at       timestamptz,
  view_count       integer NOT NULL DEFAULT 0,
  last_viewed_at   timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- AUDIT LOG
-- (immutable — insert only, no update/delete via any API endpoint)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id      uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  actor_id       uuid, -- nullable after user erasure
  actor_name     text NOT NULL, -- denormalised; replaced with "Deleted User" on erasure
  action         text NOT NULL,
    -- valid values: status_changed, version_uploaded, invitation_sent, invitation_accepted,
    --               role_changed, guest_link_created, guest_link_revoked,
    --               billing_plan_changed, billing_payment_failed
  resource_type  text NOT NULL,
    -- valid values: video, comment, membership, guest_link, billing
  resource_id    uuid NOT NULL,
  metadata       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY — ENABLE ON ALL TABLES
-- (Policies are applied in 0002_rls_policies.sql)
-- ============================================================

ALTER TABLE agencies              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE videos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_versions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE guest_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log             ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RPC: create_video_version
-- Transactionally increments version_number to prevent race conditions.
-- Called by the API layer on upload complete — never from app logic directly.
-- ============================================================

CREATE OR REPLACE FUNCTION create_video_version(
  p_video_id        uuid,
  p_agency_id       uuid,
  p_r2_key          text,
  p_file_size_bytes bigint,
  p_uploaded_by     uuid
)
RETURNS video_versions
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_version integer;
  v_new_version  video_versions;
BEGIN
  -- Lock the video row to prevent concurrent version number increments
  PERFORM id FROM videos WHERE id = p_video_id FOR UPDATE;

  -- Determine next version number
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next_version
    FROM video_versions
   WHERE video_id = p_video_id;

  -- Insert the new version
  INSERT INTO video_versions (
    video_id,
    agency_id,
    version_number,
    r2_key,
    file_size_bytes,
    uploaded_by
  )
  VALUES (
    p_video_id,
    p_agency_id,
    v_next_version,
    p_r2_key,
    p_file_size_bytes,
    p_uploaded_by
  )
  RETURNING * INTO v_new_version;

  -- Set new version as active on the parent video
  UPDATE videos
     SET active_version_id = v_new_version.id,
         updated_at        = now()
   WHERE id = p_video_id;

  RETURN v_new_version;
END;
$$;
