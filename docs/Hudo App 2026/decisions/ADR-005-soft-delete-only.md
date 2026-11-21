# ADR-005 — Comments are soft-delete only

**Status:** Accepted
**Date:** 2025 (S1)

## Decision

Comments can only be soft-deleted by setting `deleted_at`. No hard delete is possible via any API endpoint or RLS policy.

## Why

- Resolved comments are part of the review audit trail — deleting them would break the history
- If a comment has replies, hard-deleting the parent creates orphaned threads
- Agencies need to demonstrate a complete review history for compliance purposes
- Talent cannot silently erase feedback they disagreed with

## Behaviour

| Situation | UI behaviour |
|---|---|
| Comment deleted, no replies | Hidden entirely |
| Comment deleted, has replies | Show `[comment deleted]` placeholder |
| Agent resolves a comment | Visually muted — still visible |

## Enforcement

- No DELETE RLS policy on `comments` — any DELETE attempt by an authenticated client is blocked at DB level
- `DELETE /api/comments/:id` returns 405 Method Not Allowed
- Soft-delete arrives as an UPDATE in Supabase Realtime (setting `deleted_at`) — handled in `useRealtimeComments`
- The RLS SELECT policy does **not** filter `deleted_at`. App code hides soft-deleted comments: every read of `comments` filters `.is('deleted_at', null)` or checks `deleted_at !== null`

## Note: soft-delete filter is in app code, not RLS (#187)

Migration 0004 added `deleted_at IS NULL` to `comments_select`, but it was never applied to the live DBs. GitHub #187 chose option (b), keeping the live behaviour: `0029_comments_select_keep_soft_deleted` drops the filter so the repo and CI match live. A soft delete is an UPDATE, and Supabase Realtime checks each subscriber's SELECT policy against the new row, so with the filter other viewers would never get the soft-delete event. Accepted trade-off: soft-deleted comment text stays readable to the comment's own agency through direct supabase-js reads and the Realtime payload.

## Related

- [[comments]]
- [[S1-COMMENT-002]] (API enforces 405)
- [[S1-COMMENT-004]] (Realtime handles soft-delete as UPDATE event)
