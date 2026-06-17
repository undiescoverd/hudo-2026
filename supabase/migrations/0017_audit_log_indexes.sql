-- Migration: 0017_audit_log_indexes
-- Adds performance indexes to the audit_log table.
--
-- The audit_log table (created in 0001_initial_schema.sql) has no indexes
-- beyond the primary key. The two most common query patterns are:
--   1. Fetch all entries for an agency (agency dashboard audit trail)
--   2. Fetch recent entries sorted by time (global log view)
--
-- RLS and insert-only policy are pre-existing (0001 + 0002) — NOT modified here.

CREATE INDEX IF NOT EXISTS audit_log_agency_id_idx ON audit_log(agency_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at);
