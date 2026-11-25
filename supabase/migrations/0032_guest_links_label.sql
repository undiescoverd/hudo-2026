-- HUDO — GUEST LINK LABEL (S5-GUEST-002, GH #166)
-- Optional free-text label an agent attaches to a guest link ("BBC casting, Sam").
-- Agent-only metadata: never selected by any guest-facing code path.
--
-- RLS review: guest_links policies (0002) are row-level and keyed on memberships
-- (select/insert/update for owner/admin_agent/agent of the row's agency; no talent
-- access; no DELETE policy). A new column inherits them unchanged, and guests have
-- no Supabase access, so no policy change is needed.
-- Idempotent: safe to re-run.
ALTER TABLE guest_links ADD COLUMN IF NOT EXISTS label text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guest_links_label_length'
      AND conrelid = 'guest_links'::regclass
  ) THEN
    ALTER TABLE guest_links
      ADD CONSTRAINT guest_links_label_length
      CHECK (label IS NULL OR char_length(label) BETWEEN 1 AND 80);
  END IF;
END $$;
