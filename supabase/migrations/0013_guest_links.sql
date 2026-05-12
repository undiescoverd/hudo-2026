-- HUDO — GUEST LINKS INDEXES
-- Adds performance indexes for guest_links lookups by video_id and expires_at.
-- The guest_links table and its RLS policies already exist in 0001_initial_schema.sql.
CREATE INDEX IF NOT EXISTS guest_links_video_id_idx ON guest_links (video_id);
CREATE INDEX IF NOT EXISTS guest_links_expires_at_idx ON guest_links (expires_at);
