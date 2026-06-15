-- HUDO — REALTIME PUBLICATION
-- Ensures Supabase Realtime is enabled for the tables that drive live UI:
--   - comments       (S1 review thread live updates)
--   - notifications  (S2-NOTIF-003 in-app unread bell, scoped per-user by RLS)
--
-- Context: `supabase_realtime` is NOT a FOR ALL TABLES publication, so tables
-- must be added explicitly. On hudo-dev/hudo-staging this publication existed
-- but was empty (0008's comments-realtime add never landed), so neither feature
-- fired live until this was applied (2026-06-16, via MCP). This file backfills
-- that change into the repo so a fresh environment (e.g. prod) is set up cleanly.
--
-- Fully idempotent: only adds a table if it isn't already published, and skips
-- silently if the publication doesn't exist (e.g. minimal CI databases).

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publication does not exist — skipping';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['comments', 'notifications'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END
$$;
