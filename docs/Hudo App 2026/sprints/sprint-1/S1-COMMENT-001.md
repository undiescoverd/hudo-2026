---
id: S1-COMMENT-001
title: Build comment data model
sprint: 1
status: done
blocked_by: []
tags: [comments, database, migration, rls]
---

# S1-COMMENT-001 — Build comment data model

## Files

- `supabase/migrations/0006_comments.sql`

## Schema highlights

- Soft-delete only (`deleted_at`). No hard delete RLS policy.
- `comment_type`: `point | range`
- `end_timestamp_seconds` nullable (range comments only)
- `parent_id` nullable (max depth 1)
- Content limit: 2000 chars (DB-level CHECK constraint)
- Indexes on `video_version_id`, `parent_id`, `deleted_at`

## Related

- [[comments]]
- [[S1-COMMENT-002]] (API, depends on this)
- [[S1-PLAYER-003]] (timeline, depends on this)
