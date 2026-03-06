-- HUDO — VIDEO DESCRIPTION COLUMN
-- Adds nullable description column to videos.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS description text;
