---
id: S1-COMMENT-004
title: Implement real-time comment sync
sprint: 1
status: done
blocked_by: [S1-COMMENT-002]
tags: [comments, realtime, supabase]
---

# S1-COMMENT-004 — Implement real-time comment sync

## Files

- `hooks/useRealtimeComments.ts`
- `components/comments/CommentPanel.tsx`

## How it works

Supabase Realtime subscription on the `comments` table, filtered to the current `video_version_id`.

| Event | UI action |
|---|---|
| INSERT | Append new comment to list |
| UPDATE | Update comment in place (resolved, edited body) |
| Soft-delete (UPDATE with `deleted_at`) | Remove or show placeholder |

Subscription torn down on unmount or version switch.

## Channel name

`video-version:{videoVersionId}` — scoped to version, not video. See [[comments]] for why.

## Gotchas

- Must unsubscribe on version switch — stale subscription sends events for the wrong version's comments.
- Soft-delete arrives as an UPDATE event (setting `deleted_at`), not a DELETE event.

## Related

- [[S1-COMMENT-002]] [[S1-COMMENT-003]]
- [[comments]]
