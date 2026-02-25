-- ============================================================
-- HUDO — VIDEO THUMBNAIL COLUMN
-- 0009_videos_thumbnail_r2_key.sql
--
-- Adds nullable thumbnail_r2_key column to videos.
-- Existing videos will have NULL (no thumbnail).
-- ============================================================

ALTER TABLE videos ADD COLUMN IF NOT EXISTS thumbnail_r2_key text;
