-- HUDO — COMMENT READS TABLE
-- 0014_comment_reads.sql
-- Per-user per-video read-marker for unread comment counts.
-- Used by talent + agent dashboards. Insert/upsert on read;
-- query for unread = comments.created_at > last_seen_at.

CREATE TABLE IF NOT EXISTS comment_reads (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id       uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id)
);

CREATE INDEX IF NOT EXISTS comment_reads_video_id_idx ON comment_reads (video_id);

ALTER TABLE comment_reads ENABLE ROW LEVEL SECURITY;

-- RLS: user can only see + write their own read-markers.
-- Three policies (idempotent): SELECT, INSERT, UPDATE all scoped to auth.uid().
-- No DELETE policy — read-markers are not deletable from the API.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comment_reads' AND policyname='comment_reads_select_own') THEN
    CREATE POLICY comment_reads_select_own ON comment_reads
      FOR SELECT
      USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comment_reads' AND policyname='comment_reads_insert_own') THEN
    CREATE POLICY comment_reads_insert_own ON comment_reads
      FOR INSERT
      WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='comment_reads' AND policyname='comment_reads_update_own') THEN
    CREATE POLICY comment_reads_update_own ON comment_reads
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
