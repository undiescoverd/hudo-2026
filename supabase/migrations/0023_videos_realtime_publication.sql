-- HUDO — REALTIME PUBLICATION (videos)
-- Adds `videos` to the `supabase_realtime` publication so video status
-- changes (S4 talent self-upload — auto-flip to pending_review on a
-- completed talent upload) propagate live to signed-in members without a
-- manual refresh.
--
-- Context: postgres_changes respects RLS per subscriber, so a single
-- `videos` publication entry is safe to share across roles — agents get
-- agency-wide video events (their memberships cover the whole agency) while
-- talent only receive events for their own videos. No separate per-role
-- publication is needed.
--
-- Follows the exact idempotent DO-block style of 0016_realtime_publication.sql:
-- only adds a table if it isn't already published, and skips silently if the
-- publication doesn't exist (e.g. minimal CI databases).

DO $$
DECLARE
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime publication does not exist — skipping';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['videos'] LOOP
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
