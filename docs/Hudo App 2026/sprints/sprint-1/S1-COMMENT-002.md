---
id: S1-COMMENT-002
title: Build comment API
sprint: 1
status: done
blocked_by: [S1-COMMENT-001]
tags: [comments, api, soft-delete]
---

# S1-COMMENT-002 — Build comment API

## Files

- `app/api/videos/[id]/versions/[versionId]/comments/route.ts`
- `app/api/comments/[id]/route.ts`
- `lib/comments.ts`

## Endpoints

| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/videos/:id/versions/:versionId/comments` | Non-deleted, sorted by `timestamp_start` |
| POST | `/api/videos/:id/versions/:versionId/comments` | Point or range comment |
| PATCH | `/api/comments/:id` | Update body (own) or `resolved_at` (agents+) |
| DELETE | `/api/comments/:id` | Sets `deleted_at` — hard delete returns 405 |

## Rules

- All endpoints: auth required, agency scoped, rate limited
- 2000 char body limit enforced server-side
- Agents can resolve/unresolve any comment in their agency
- Talent: create and soft-delete own only

## Related

- [[S1-COMMENT-001]]
- [[S1-COMMENT-003]] (UI panel, depends on this)
- [[S1-COMMENT-004]] (realtime, depends on this)
- [[S1-COMMENT-005]] (input, depends on this)
- [[comments]]
