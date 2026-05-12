-- HUDO — NOTIFICATIONS BATCHED EMAIL DELIVERY
-- Extends notifications and notification_preferences tables with columns for batched email delivery.
-- Idempotent: safe to re-run.

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS payload jsonb,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz;

ALTER TABLE notification_preferences
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS notifications_recipient_id_read_at_idx
  ON notifications (recipient_id, read_at);

CREATE INDEX IF NOT EXISTS notifications_recipient_id_sent_at_idx
  ON notifications (recipient_id, sent_at);

CREATE INDEX IF NOT EXISTS notifications_agency_id_created_at_idx
  ON notifications (agency_id, created_at);
